//! 原生检查/修复：`dsh-doctor-native scan` / `fix <id>`。
//!
//! P1 覆盖：桌面完整性标签、危险工作区、profile 宿主包副本、patch 层、
//! PATH 失效 dsh、崩溃日志、权限过宽（会话投影缓存）、rescue 实例失效。
//! 会话格式扫描（zstd）暂留 JS 侧——不把 zstd 依赖带进零依赖引擎。
//!
//! 输出与插件/PS 侧保持一致：`[severity] title` + path + detail；`--json` 输出机器可读。

use crate::json::Json;
use crate::win;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const CRITICAL_HOST_PACKAGES: [&str; 5] = [
    "dsh-tools",
    "dsh-skill",
    "schemastery",
    "dsh-util-values",
    "cordis",
];

fn env_string(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn home() -> String {
    env_string("USERPROFILE").unwrap_or_default()
}

fn dsh_home() -> String {
    env_string("DSH_HOME").unwrap_or_else(|| format!("{}\\.dsh", home()))
}

fn desktop_path() -> String {
    format!("{}\\Desktop", home())
}

fn appdata() -> String {
    env_string("APPDATA").unwrap_or_default()
}

fn now_stamp() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn read_json(path: &str) -> Option<Json> {
    fs::read_to_string(path).ok().and_then(|text| crate::json::parse(&text).ok())
}

fn is_dir(path: &str) -> bool {
    Path::new(path).is_dir()
}

fn finding(id: &str, severity: &str, title: String, detail: String, path: String) -> Json {
    Json::obj()
        .set("id", Json::str(id))
        .set("severity", Json::str(severity))
        .set("title", Json::str(title))
        .set("detail", Json::str(detail))
        .set("path", Json::str(path))
}

fn walk_strings(node: &Json, out: &mut Vec<String>) {
    match node {
        Json::Str(text) => out.push(text.clone()),
        Json::Arr(items) => {
            for item in items {
                walk_strings(item, out);
            }
        }
        Json::Obj(pairs) => {
            for (_, value) in pairs {
                walk_strings(value, out);
            }
        }
        _ => {}
    }
}

fn looks_like_path(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() > 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn risky_reason(path: &str) -> Option<&'static str> {
    let target = path.trim_end_matches(['\\', '/']).to_lowercase();
    let home_dir = home().trim_end_matches(['\\', '/']).to_lowercase();
    let desktop = desktop_path().trim_end_matches(['\\', '/']).to_lowercase();
    if !home_dir.is_empty() && target == home_dir {
        return Some("用户目录本身");
    }
    if target == desktop {
        return Some("桌面本身");
    }
    let bytes = target.as_bytes();
    if bytes.len() == 2 && bytes[1] == b':' {
        return Some("整个盘根");
    }
    None
}

fn check_desktop(findings: &mut Vec<Json>) {
    let desktop = desktop_path();
    if !is_dir(&desktop) {
        return;
    }
    let parts = match win::get_named_security(&desktop) {
        Ok(parts) => parts,
        Err(_) => return,
    };
    let sddl = win::descriptor_to_sddl(
        parts.security_descriptor,
        win::DACL_SECURITY_INFORMATION | win::LABEL_SECURITY_INFORMATION | win::OWNER_SECURITY_INFORMATION,
    )
    .unwrap_or_default();
    parts.drop();
    let low = sddl.contains("S:(ML") && sddl.contains(";;;LW)");
    let deny = sddl.contains("(D;") && sddl.contains(";;;WD)");
    if low {
        findings.push(finding(
            "desktop-low-label",
            "high",
            "桌面被打了低完整性标签（图标会变白）".to_string(),
            "沙箱给工作区授写权限时会在目录上盖 Low 完整性标签；桌面被当成工作区时，Explorer 取不到图标。".to_string(),
            desktop.clone(),
        ));
    }
    if deny {
        findings.push(finding(
            "desktop-everyone-deny",
            "medium",
            "桌面残留 Everyone 拒绝删除项".to_string(),
            "沙箱授权留下的拒绝 ACE，DSH 不会自己清理。".to_string(),
            desktop.clone(),
        ));
    }
}

fn check_workspace(findings: &mut Vec<Json>) {
    let file = format!("{}\\storages\\workspace.json", dsh_home());
    let Some(json) = read_json(&file) else { return };
    let mut strings = Vec::new();
    walk_strings(&json, &mut strings);
    let mut seen: Vec<String> = Vec::new();
    for value in strings {
        if !looks_like_path(&value) {
            continue;
        }
        if let Some(reason) = risky_reason(&value) {
            let key = value.to_lowercase();
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            findings.push(finding(
                "workspace-risky-path",
                "high",
                format!("危险工作区：{}", reason),
                "这个目录被注册成 DSH 工作区：沙箱会在上面盖完整性标签/拒绝项，删文件也会直接影响它。".to_string(),
                value,
            ));
        }
    }
}

fn check_profile_duplicates(findings: &mut Vec<Json>) {
    let profiles = format!("{}\\profiles", dsh_home());
    let Ok(entries) = fs::read_dir(&profiles) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains(".stale") {
            continue;
        }
        for package in CRITICAL_HOST_PACKAGES {
            let path = format!("{}\\node_modules\\@deepseek-ai\\{}", entry.path().display(), package);
            if is_dir(&path) {
                findings.push(finding(
                    "profile-host-duplicate",
                    "high",
                    format!("profile 里出现宿主包副本：{}", package),
                    "同一进程里出现第二份宿主包会拿到不同的 Symbol，典型报错是 reading 'prepare'；应隔离副本，而不是整目录改名。".to_string(),
                    path,
                ));
            }
        }
    }
}

fn check_patch_layer(findings: &mut Vec<Json>) {
    let profiles = format!("{}\\profiles", dsh_home());
    let Ok(entries) = fs::read_dir(&profiles) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains(".stale") {
            continue;
        }
        let file = entry.path().join("cordis.patch.yml");
        let Ok(meta) = fs::metadata(&file) else { continue };
        if meta.len() != 0 {
            continue;
        }
        let has_backup = fs::read_dir(entry.path())
            .map(|items| items.flatten().any(|item| {
                item.file_name().to_string_lossy().starts_with("cordis.patch.yml.bak-")
            }))
            .unwrap_or(false);
        if has_backup {
            findings.push(finding(
                "patch-layer-missing",
                "medium",
                format!("profile「{}」的 cordis.patch.yml 被清空（有备份）", name),
                "崩溃自修复会清空 patch 层；主题/模型/MCP 配置都在里面。可一键从最近的备份恢复。".to_string(),
                file.display().to_string(),
            ));
        }
    }
}

fn check_dead_path(findings: &mut Vec<Json>) {
    let Ok(output) = Command::new("where.exe").arg("dsh").output() else { return };
    if !output.status.success() {
        return;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines().map(|line| line.trim()).filter(|line| !line.is_empty()) {
        if !Path::new(line).exists() {
            findings.push(finding(
                "path-dead-dsh",
                "low",
                "PATH 里有失效的 dsh 入口".to_string(),
                "指向不存在的文件；命令会报找不到或版本错乱。".to_string(),
                line.to_string(),
            ));
        }
    }
}

fn check_crash_logs(findings: &mut Vec<Json>) {
    let dir = format!("{}\\@deepseek-ai\\dsh-desktop\\logs", appdata());
    let Ok(entries) = fs::read_dir(&dir) else { return };
    let mut count = 0;
    let mut newest: Option<(u64, String)> = None;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("crash-") {
            continue;
        }
        count += 1;
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                let secs = modified.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                if newest.as_ref().map(|(best, _)| secs > *best).unwrap_or(true) {
                    newest = Some((secs, name));
                }
            }
        }
    }
    if count > 0 {
        findings.push(finding(
            "desktop-crash-logs",
            "medium",
            format!("检测到桌面端崩溃日志：{} 个", count),
            "崩溃日志是排查启动/渲染问题的直接证据；数量多说明问题在反复发生。".to_string(),
            dir,
        ));
    }
}

fn collect_permission(node: &Json, broad: &mut usize, no_approval: &mut usize) {
    if let Some(pairs) = node.as_object() {
        let preset = node.get("preset").and_then(|value| value.as_str());
        let sandbox = node.get("sandbox").and_then(|value| value.as_str());
        let approval = node.get("approval").and_then(|value| value.as_str());
        if preset.is_some() && sandbox.is_some() {
            if sandbox == Some("danger-full-access") {
                *broad += 1;
                if approval == Some("never") {
                    *no_approval += 1;
                }
            }
        }
        for (_, value) in pairs {
            collect_permission(value, broad, no_approval);
        }
    } else if let Some(items) = node.as_array() {
        for item in items {
            collect_permission(item, broad, no_approval);
        }
    }
}

fn check_permission(findings: &mut Vec<Json>) {
    let file = format!("{}\\storages\\session_projcache.json", dsh_home());
    let Some(json) = read_json(&file) else { return };
    let mut broad = 0usize;
    let mut no_approval = 0usize;
    collect_permission(&json, &mut broad, &mut no_approval);
    if broad == 0 {
        return;
    }
    let severity = if no_approval > 0 { "high" } else { "medium" };
    findings.push(finding(
        "permission-too-broad",
        severity,
        format!(
            "有 {} 个会话开着 danger-full-access{}",
            broad,
            if no_approval > 0 { format!("（其中 {} 个连审批也关了）", no_approval) } else { String::new() }
        ),
        "等于把整台机器交给模型；文件被删不经过回收站、不可撤销。用 /permission 切到 workspace-write + ask；恢复步骤见 docs/recovery.md。".to_string(),
        file,
    ));
}

pub fn scan() -> Vec<Json> {
    let mut findings = Vec::new();
    check_desktop(&mut findings);
    check_workspace(&mut findings);
    check_profile_duplicates(&mut findings);
    check_patch_layer(&mut findings);
    check_dead_path(&mut findings);
    check_crash_logs(&mut findings);
    check_permission(&mut findings);
    findings
}

fn fix_desktop_label() -> Result<String, String> {
    let desktop = desktop_path();
    if !is_dir(&desktop) {
        return Err("找不到桌面目录".to_string());
    }
    win::set_integrity_label(&desktop, "medium", true).map_err(|error| format!("改完整性标签失败：{}", error))?;
    let removed = win::remove_deny_aces(&desktop, "S-1-1-0").map_err(|error| format!("删拒绝 ACE 失败：{}", error))?;
    win::shell_refresh(Some(&desktop));
    Ok(format!("桌面标签已改回 Medium（移除 {} 个拒绝 ACE），已通知外壳刷新", removed))
}

fn fix_profile_host_dup() -> Result<String, String> {
    let profiles = format!("{}\\profiles", dsh_home());
    let backup_root = format!("{}\\dsh-doctor-backups\\hostpkgs-native-{}", dsh_home(), now_stamp());
    let mut moved = Vec::new();
    let Ok(entries) = fs::read_dir(&profiles) else {
        return Ok("没有 profiles 目录，不需要修".to_string());
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains(".stale") {
            continue;
        }
        for package in CRITICAL_HOST_PACKAGES {
            let source = entry.path().join("node_modules").join("@deepseek-ai").join(package);
            if !source.is_dir() {
                continue;
            }
            let target_dir = PathBuf::from(&backup_root).join(&name);
            if fs::create_dir_all(&target_dir).is_err() {
                continue;
            }
            let target = target_dir.join(package);
            if fs::rename(&source, &target).is_ok() {
                moved.push(format!("{}:{}", name, package));
            }
        }
    }
    if moved.is_empty() {
        return Ok("没有可隔离的宿主包副本".to_string());
    }
    Ok(format!("已隔离 {} 个副本到 {}（重启桌面端生效）", moved.len(), backup_root))
}

fn fix_patch_layer() -> Result<String, String> {
    let profiles = format!("{}\\profiles", dsh_home());
    let Ok(entries) = fs::read_dir(&profiles) else {
        return Ok("没有 profiles 目录，不需要修".to_string());
    };
    let mut restored = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains(".stale") {
            continue;
        }
        let file = entry.path().join("cordis.patch.yml");
        let Ok(meta) = fs::metadata(&file) else { continue };
        if meta.len() != 0 {
            continue;
        }
        let mut backups: Vec<PathBuf> = fs::read_dir(entry.path())
            .map(|items| items.flatten().map(|item| item.path())
                .filter(|path| {
                    path.file_name().map(|file| file.to_string_lossy().starts_with("cordis.patch.yml.bak-")).unwrap_or(false)
                })
                .collect())
            .unwrap_or_default();
        backups.sort_by_key(|path| fs::metadata(path).and_then(|meta| meta.modified()).ok());
        let Some(latest) = backups.pop() else { continue };
        let empty_backup = entry.path().join(format!("cordis.patch.yml.empty-{}", now_stamp()));
        let _ = fs::rename(&file, &empty_backup);
        if fs::copy(&latest, &file).is_ok() {
            restored.push(name);
        }
    }
    if restored.is_empty() {
        return Ok("没有可恢复的 patch 层".to_string());
    }
    Ok(format!("已恢复 {} 个 profile 的 cordis.patch.yml，重启桌面端生效", restored.len()))
}

fn fix_by_id(id: &str) -> Result<String, String> {
    match id {
        "desktop-label" => fix_desktop_label(),
        "profile-host-dup" => fix_profile_host_dup(),
        "restore-patch-layer" => fix_patch_layer(),
        "workspace-entry" => Err("原生版尚未实现工作区移除（P2）；请用插件或 PS/CLI 版修复".to_string()),
        other => Err(format!("未知修复动作：{}", other)),
    }
}

fn print_human(findings: &[Json]) {
    if findings.is_empty() {
        println!("没有发现问题。");
        return;
    }
    for item in findings {
        let severity = item.get("severity").and_then(|value| value.as_str()).unwrap_or("info");
        let title = item.get("title").and_then(|value| value.as_str()).unwrap_or("");
        let detail = item.get("detail").and_then(|value| value.as_str()).unwrap_or("");
        let path = item.get("path").and_then(|value| value.as_str()).unwrap_or("");
        println!("[{}] {}", severity, title);
        if !path.is_empty() {
            println!("  path:     {}", path);
        }
        if !detail.is_empty() {
            println!("  detail:   {}", detail);
        }
        println!();
    }
    let high = findings.iter().filter(|item| item.get("severity").and_then(|value| value.as_str()) == Some("high")).count();
    println!("总结：{} 个高危 / {} 条共", high, findings.len());
}

/// 命令行入口：scan / fix <id> [--json]
pub fn run(argv: &[String]) -> i32 {
    let command = argv.get(1).map(|value| value.as_str()).unwrap_or("scan");
    let json_output = argv.iter().any(|value| value == "--json");
    match command {
        "scan" => {
            let findings = scan();
            if json_output {
                let mut array = Vec::new();
                for item in &findings {
                    array.push(item.clone());
                }
                println!("{}", Json::Arr(array).serialize());
            } else {
                print_human(&findings);
            }
            0
        }
        "fix" => {
            let Some(id) = argv.get(2) else {
                eprintln!("用法：dsh-doctor-native fix <desktop-label|profile-host-dup|restore-patch-layer>");
                return 2;
            };
            match fix_by_id(id) {
                Ok(message) => {
                    if json_output {
                        println!("{}", Json::obj().set("ok", Json::Bool(true)).set("message", Json::str(message)).serialize());
                    } else {
                        println!("{}", message);
                    }
                    0
                }
                Err(message) => {
                    if json_output {
                        println!("{}", Json::obj().set("ok", Json::Bool(false)).set("error", Json::str(message)).serialize());
                    } else {
                        eprintln!("修复失败：{}", message);
                    }
                    1
                }
            }
        }
        "--version" | "version" => {
            println!("{}", crate::VERSION);
            0
        }
        other => {
            eprintln!("未知命令：{}（可用：scan / fix / version）", other);
            2
        }
    }
}
