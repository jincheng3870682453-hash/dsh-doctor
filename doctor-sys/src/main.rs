//! doctor-sys：dsh-doctor 的底层原语引擎（设计文档 D1 / §9）。
//!
//! 协议：JSON over stdio，每个请求一个进程。
//!   请求（stdin 或命令行）：{"op":"acl-read","args":{"path":"C:\\..."}}
//!   响应（stdout）：        {"ok":true,"op":"acl-read","data":{...}}
//!                          {"ok":false,"op":"acl-read","error":"..."}
//!
//! 安全边界：没有 exec、没有 shell——原语表是封闭的动词表（docs/design.md §9）。
//! 注册表原语 v1 未实现（现有引擎用不到，宁缺毋滥）。

mod json;
mod win;

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use json::Json;

const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), " (dsh-doctor doctor-sys)");

fn main() {
    let mut stdout = std::io::stdout();

    let (op, args) = match read_request() {
        Ok(parsed) => parsed,
        Err(error) => {
            let _ = writeln!(stdout, "{}", Json::obj()
                .set("ok", Json::Bool(false))
                .set("op", Json::str("request"))
                .set("error", Json::str(error))
                .serialize());
            std::process::exit(2);
        }
    };

    let result = dispatch(&op, &args);
    let response = match result {
        Ok(data) => Json::obj()
            .set("ok", Json::Bool(true))
            .set("op", Json::str(op.clone()))
            .set("data", data),
        Err(error) => Json::obj()
            .set("ok", Json::Bool(false))
            .set("op", Json::str(op.clone()))
            .set("error", Json::str(error)),
    };
    let _ = writeln!(stdout, "{}", response.serialize());
}

fn read_request() -> Result<(String, Json), String> {
    let params: Vec<String> = std::env::args().skip(1).collect();
    if params.is_empty() {
        // stdio 模式：整份 JSON 从 stdin 读。
        let mut text = String::new();
        std::io::stdin().read_to_string(&mut text).map_err(|error| format!("读 stdin 失败：{}", error))?;
        let parsed = json::parse(text.trim()).map_err(|error| format!("请求不是合法 JSON：{}", error))?;
        let op = parsed.get("op").and_then(|value| value.as_str()).ok_or("缺少 op 字段")?.to_string();
        let args = parsed.get("args").cloned().unwrap_or_else(Json::obj);
        return Ok((op, args));
    }
    if params[0] == "--version" || params[0] == "version" {
        return Ok(("version".into(), Json::obj()));
    }
    if params[0] == "help" || params[0] == "--help" || params[0] == "-h" {
        return Ok(("help".into(), Json::obj()));
    }
    // 命令行模式：doctor-sys.exe acl-read --path "C:\..."
    let op = params[0].clone();
    let mut args = Json::obj();
    let mut index = 1;
    while index < params.len() {
        let key = params[index].trim_start_matches('-').to_string();
        if index + 1 < params.len() && !params[index + 1].starts_with("--") {
            args = args.set(&key, Json::str(params[index + 1].clone()));
            index += 2;
        } else {
            args = args.set(&key, Json::Bool(true));
            index += 1;
        }
    }
    Ok((op, args))
}

fn dispatch(op: &str, args: &Json) -> Result<Json, String> {
    match op {
        "version" => Ok(Json::obj().set("version", Json::str(VERSION))),
        "help" => Ok(Json::obj().set("usage", Json::str(USAGE))),
        "acl-read" => op_acl_read(args),
        "acl-save" => op_acl_save(args),
        "acl-restore" => op_acl_restore(args),
        "set-integrity-label" => op_set_integrity_label(args),
        "remove-deny-ace" => op_remove_deny_ace(args),
        "proc-list" => win::processes_to_json(),
        "proc-kill-tree" => op_proc_kill_tree(args),
        "port-probe" => op_port_probe(args),
        "port-pid" => op_port_pid(args),
        "shell-refresh" => op_shell_refresh(args),
        "quarantine-dir" => op_quarantine_dir(args),
        "snapshot-write" => op_snapshot_write(args),
        "snapshot-restore" => op_snapshot_restore(args),
        "notify" => op_notify(args),
        "selftest" => op_selftest(args),
        other => Err(format!("未知原语 '{}'。可用：{}", other, PRIMITIVES)),
    }
}

const PRIMITIVES: &str = "acl-read, acl-save, acl-restore, set-integrity-label, remove-deny-ace, \
    proc-list, proc-kill-tree, port-probe, port-pid, shell-refresh, quarantine-dir, \
    snapshot-write, snapshot-restore, notify, selftest";

const USAGE: &str = "用法：\n\
    \x20 doctor-sys.exe <op> --参数 值 ...        命令行模式\n\
    \x20 echo {\"op\":\"<op>\",\"args\":{...}} | doctor-sys.exe   stdio 模式\n\
    原语表：acl-read / acl-save / acl-restore / set-integrity-label / remove-deny-ace / \
    proc-list / proc-kill-tree / port-probe / port-pid / shell-refresh / quarantine-dir / \
    snapshot-write / snapshot-restore / notify / selftest\n\
    明细：docs/design.md §9 与 doctor-sys/README.md";

// ── 参数取值小工具 ──────────────────────────────────────────────────────

fn arg_str(args: &Json, key: &str) -> Result<String, String> {
    args.get(key).and_then(|value| value.as_str()).map(|text| text.to_string())
        .ok_or_else(|| format!("缺少参数 {}", key))
}

fn arg_bool(args: &Json, key: &str) -> bool {
    args.get(key).and_then(|value| value.as_bool()).unwrap_or(false)
}

fn arg_i64(args: &Json, key: &str) -> Result<i64, String> {
    match args.get(key) {
        Some(Json::Num(value)) if value.fract() == 0.0 && value.abs() < 9.0e15 => Ok(*value as i64),
        // 命令行模式下所有参数都是字符串，数字也得从字符串解析。
        Some(Json::Str(text)) => text.parse::<i64>().map_err(|_| format!("参数 {} 不是数字：{}", key, text)),
        _ => Err(format!("缺少或非法的数字参数 {}", key)),
    }
}

// ── ACL 原语 ────────────────────────────────────────────────────────────

fn op_acl_read(args: &Json) -> Result<Json, String> {
    let path = arg_str(args, "path")?;
    if !Path::new(&path).exists() {
        return Err(format!("路径不存在：{}", path));
    }
    let parts = win::get_named_security(&path)?;
    let info = win::OWNER_SECURITY_INFORMATION | win::GROUP_SECURITY_INFORMATION
        | win::DACL_SECURITY_INFORMATION | win::LABEL_SECURITY_INFORMATION;
    let sddl = win::descriptor_to_sddl(parts.security_descriptor, info)
        .unwrap_or_else(|_| String::new());
    let owner = if parts.owner.is_null() { String::new() } else { win::sid_to_string(parts.owner).unwrap_or_default() };
    let group = if parts.group.is_null() { String::new() } else { win::sid_to_string(parts.group).unwrap_or_default() };
    let label = win::label_from_sddl(&sddl).map(Json::str).unwrap_or(Json::Null);
    parts.drop();
    Ok(Json::obj()
        .set("path", Json::str(path))
        .set("sddl", Json::str(sddl))
        .set("owner", Json::str(owner))
        .set("group", Json::str(group))
        .set("integrity", label))
}

fn op_acl_save(args: &Json) -> Result<Json, String> {
    let path = arg_str(args, "path")?;
    let file = arg_str(args, "file")?;
    let parts = win::get_named_security(&path)?;
    let info = win::OWNER_SECURITY_INFORMATION | win::GROUP_SECURITY_INFORMATION
        | win::DACL_SECURITY_INFORMATION | win::LABEL_SECURITY_INFORMATION;
    let sddl = win::descriptor_to_sddl(parts.security_descriptor, info)?;
    parts.drop();
    let payload = Json::obj()
        .set("path", Json::str(path.clone()))
        .set("sddl", Json::str(sddl))
        .set("savedAt", Json::str(iso_now()));
    if let Some(parent) = Path::new(&file).parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("建备份目录失败：{}", error))?;
    }
    std::fs::write(&file, payload.serialize()).map_err(|error| format!("写备份失败：{}（{}", file, error))?;
    Ok(Json::obj().set("file", Json::str(file)).set("path", Json::str(path)))
}

fn op_acl_restore(args: &Json) -> Result<Json, String> {
    let file = arg_str(args, "file")?;
    let text = std::fs::read_to_string(&file).map_err(|error| format!("读备份失败：{}（{}", file, error))?;
    let parsed = json::parse(&text).map_err(|error| format!("备份不是合法 JSON：{}", error))?;
    let path = parsed.get("path").and_then(|value| value.as_str()).ok_or("备份里缺少 path")?.to_string();
    let sddl = parsed.get("sddl").and_then(|value| value.as_str()).ok_or("备份里缺少 sddl")?.to_string();
    // 备份没标签时 restore_sddl 会随行当前标签（或 medium），见其文档注释。
    let applied = win::restore_sddl(&path, &sddl)?;
    Ok(Json::obj().set("path", Json::str(path)).set("applied", Json::str(applied)))
}

fn op_set_integrity_label(args: &Json) -> Result<Json, String> {
    let path = arg_str(args, "path")?;
    let label = arg_str(args, "label")?;
    let recursive = arg_bool(args, "recursive") || arg_bool(args, "children");
    let mut changed = 1usize;
    win::set_integrity_label(&path, &label, recursive)?;
    if recursive {
        changed = walk_apply(&path, &|entry| win::set_integrity_label(&entry, &label, false).is_ok());
    }
    Ok(Json::obj()
        .set("path", Json::str(path))
        .set("label", Json::str(label))
        .set("applied", Json::num(changed as i64)))
}

fn op_remove_deny_ace(args: &Json) -> Result<Json, String> {
    let path = arg_str(args, "path")?;
    let sid = if arg_bool(args, "everyone") { "S-1-1-0".to_string() } else { arg_str(args, "sid")? };
    let removed = win::remove_deny_aces(&path, &sid)?;
    Ok(Json::obj()
        .set("path", Json::str(path))
        .set("sid", Json::str(sid))
        .set("removed", Json::num(removed as i64)))
}

// ── 进程 / 端口原语 ────────────────────────────────────────────────────

fn op_proc_kill_tree(args: &Json) -> Result<Json, String> {
    let pid = arg_i64(args, "pid")? as u32;
    let dry_run = arg_bool(args, "dryRun");
    let killed = win::kill_tree(pid, dry_run)?;
    let items = killed.iter().map(|value| Json::num(*value as i64)).collect();
    Ok(Json::obj()
        .set("pid", Json::num(pid as i64))
        .set("dryRun", Json::Bool(dry_run))
        .set("killed", Json::Arr(items)))
}

fn op_port_probe(args: &Json) -> Result<Json, String> {
    let port = arg_i64(args, "port")? as u16;
    let host = args.get("host").and_then(|value| value.as_str()).unwrap_or("127.0.0.1").to_string();
    let timeout_ms = args.get("timeoutMs").and_then(|value| value.as_i64()).unwrap_or(1500) as u64;
    let address = (host.as_str(), port).to_socket_addrs()
        .map_err(|error| format!("地址解析失败：{}:{}（{}", host, port, error))?
        .next().ok_or("地址解析没有结果")?;
    let open = TcpStream::connect_timeout(&address, Duration::from_millis(timeout_ms)).is_ok();
    Ok(Json::obj().set("host", Json::str(host)).set("port", Json::num(port as i64)).set("open", Json::Bool(open)))
}

fn op_port_pid(args: &Json) -> Result<Json, String> {
    let port = arg_i64(args, "port")? as u16;
    let pid = win::tcp_listener_pid(port)?;
    Ok(Json::obj().set("port", Json::num(port as i64)).set("pid", pid.map(|value| Json::num(value as i64)).unwrap_or(Json::Null)))
}

// ── 外壳 / 文件原语 ────────────────────────────────────────────────────

fn op_shell_refresh(args: &Json) -> Result<Json, String> {
    let path = args.get("path").and_then(|value| value.as_str()).map(|text| text.to_string());
    win::shell_refresh(path.as_deref());
    Ok(Json::obj().set("path", path.map(Json::str).unwrap_or(Json::Null)).set("notified", Json::Bool(true)))
}

fn unique_target(path: &Path) -> PathBuf {
    let stamp = stamp_now();
    let mut candidate = path.with_extension(format!("doctor-quarantine-{}", stamp));
    let mut counter = 2;
    while candidate.exists() {
        candidate = path.with_extension(format!("doctor-quarantine-{}-{}", stamp, counter));
        counter += 1;
    }
    candidate
}

fn op_quarantine_dir(args: &Json) -> Result<Json, String> {
    let path = arg_str(args, "path")?;
    let source = Path::new(&path);
    if !source.exists() {
        return Err(format!("路径不存在：{}", path));
    }
    let target = unique_target(source);
    std::fs::rename(source, &target).map_err(|error| format!("隔离失败（改名）：{}（{}", path, error))?;
    Ok(Json::obj()
        .set("original", Json::str(path))
        .set("quarantined", Json::str(target.to_string_lossy().into_owned())))
}

// ── 快照原语 ────────────────────────────────────────────────────────────

fn copy_all(source: &Path, target: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(source).map_err(|error| format!("读 {} 失败：{}", source.display(), error))?;
    if meta.is_dir() {
        std::fs::create_dir_all(target).map_err(|error| format!("建 {} 失败：{}", target.display(), error))?;
        let entries = std::fs::read_dir(source).map_err(|error| format!("列 {} 失败：{}", source.display(), error))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("遍历 {} 失败：{}", source.display(), error))?;
            copy_all(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| format!("建 {} 失败：{}", parent.display(), error))?;
        }
        std::fs::copy(source, target).map_err(|error| format!("复制 {} 失败：{}", source.display(), error))?;
    }
    Ok(())
}

fn op_snapshot_write(args: &Json) -> Result<Json, String> {
    let dest = arg_str(args, "destDir")?;
    // stdio 模式传数组；命令行模式传分号分隔的字符串（Windows 路径里不会有分号）。
    let paths: Vec<String> = match args.get("paths") {
        Some(Json::Arr(items)) => items.iter()
            .map(|item| item.as_str().map(|text| text.to_string()).ok_or("paths 里必须是字符串"))
            .collect::<Result<Vec<_>, _>>()?,
        Some(Json::Str(text)) if !text.trim().is_empty() =>
            text.split(';').map(|piece| piece.trim().to_string()).filter(|piece| !piece.is_empty()).collect(),
        _ => return Err("缺少 paths（数组或分号分隔的字符串）".into()),
    };
    if paths.is_empty() {
        return Err("paths 是空的".into());
    }
    let data_dir = Path::new(&dest).join("data");
    std::fs::create_dir_all(&data_dir).map_err(|error| format!("建快照目录失败：{}", error))?;
    let mut entries = Vec::new();
    for (index, item) in paths.iter().enumerate() {
        let original = item.as_str();
        let source = Path::new(original);
        if !source.exists() {
            return Err(format!("路径不存在：{}", original));
        }
        let stored = data_dir.join(format!("{:04}-{}", index, source.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unnamed".into())));
        copy_all(source, &stored)?;
        entries.push(Json::obj()
            .set("original", Json::str(original))
            .set("stored", Json::str(stored.to_string_lossy().into_owned())));
    }
    let manifest = Json::obj()
        .set("created", Json::str(iso_now()))
        .set("entries", Json::Arr(entries));
    let manifest_path = Path::new(&dest).join("manifest.json");
    std::fs::write(&manifest_path, manifest.serialize())
        .map_err(|error| format!("写 manifest 失败：{}", error))?;
    Ok(Json::obj().set("snapshotDir", Json::str(dest)).set("count", Json::num(paths.len() as i64)))
}

fn op_snapshot_restore(args: &Json) -> Result<Json, String> {
    let snapshot_dir = arg_str(args, "snapshotDir")?;
    let manifest_path = Path::new(&snapshot_dir).join("manifest.json");
    let text = std::fs::read_to_string(&manifest_path)
        .map_err(|error| format!("读 manifest 失败：{}（{}", manifest_path.display(), error))?;
    let manifest = json::parse(&text).map_err(|error| format!("manifest 不是合法 JSON：{}", error))?;
    let entries = manifest.get("entries").and_then(|value| value.as_array()).ok_or("manifest 里没有 entries")?;
    let backup_dir = Path::new(&snapshot_dir).join(format!("restore-backup-{}", stamp_now()));
    let mut restored = 0i64;
    for entry in entries {
        let original = entry.get("original").and_then(|value| value.as_str()).ok_or("条目缺 original")?;
        let stored = entry.get("stored").and_then(|value| value.as_str()).ok_or("条目缺 stored")?;
        let target = Path::new(original);
        if target.exists() {
            // 恢复前先备份现状，可回滚。
            let backup = backup_dir.join(target.file_name().unwrap_or_default());
            copy_all(target, &backup).map_err(|error| format!("备份 {} 失败：{}", original, error))?;
        }
        std::fs::remove_dir_all(target).or_else(|_| std::fs::remove_file(target)).ok();
        copy_all(Path::new(stored), target)?;
        restored += 1;
    }
    Ok(Json::obj()
        .set("restored", Json::num(restored))
        .set("backupDir", Json::str(backup_dir.to_string_lossy().into_owned())))
}

// ── 通知原语 ────────────────────────────────────────────────────────────

fn op_notify(args: &Json) -> Result<Json, String> {
    let title = arg_str(args, "title")?;
    let body = arg_str(args, "body")?;
    let max_wait = args.get("timeoutMs").and_then(|value| value.as_i64()).unwrap_or(10_000) as u32;
    let shown = win::balloon(&title, &body, max_wait);
    Ok(Json::obj().set("title", Json::str(title)).set("shown", Json::Bool(shown)))
}

// ── 自检 ────────────────────────────────────────────────────────────────

fn op_selftest(_args: &Json) -> Result<Json, String> {
    let mut checks: Vec<Json> = Vec::new();

    let json_ok = (|| {
        let text = Json::obj().set("path", Json::str("C:\\中文\\路径")).set("n", Json::num(-5)).serialize();
        let parsed = json::parse(&text)?;
        if parsed.get("path").and_then(|value| value.as_str()) != Some("C:\\中文\\路径") {
            return Err("JSON 中文往返不一致".into());
        }
        Ok(())
    })();
    checks.push(result_check("json-roundtrip", json_ok));

    let temp = std::env::temp_dir().join(format!("doctor-sys-selftest-{}.txt", std::process::id()));
    let acl_ok = (|| -> Result<(), String> {
        // DSH 沙箱会拒绝写 %TEMP%（HANDOFF 5.6），退回当前目录。
        let mut probe = temp.clone();
        if std::fs::write(&probe, b"selftest").is_err() {
            probe = std::env::current_dir().map_err(|error| format!("拿当前目录失败：{}", error))?
                .join(format!("doctor-sys-selftest-{}.txt", std::process::id()));
        }
        std::fs::write(&probe, b"selftest").map_err(|error| format!("建临时文件失败：{}", error))?;
        let data = op_acl_read(&Json::obj().set("path", Json::str(probe.to_string_lossy().into_owned())))?;
        let _ = std::fs::remove_file(&probe);
        if data.get("sddl").and_then(|value| value.as_str()).map(|text| text.contains("D:")).unwrap_or(false) {
            Ok(())
        } else {
            Err("SDDL 里没有 DACL 段".into())
        }
    })();
    let _ = std::fs::remove_file(&temp);
    checks.push(result_check("acl-read", acl_ok));

    let probe = op_port_probe(&Json::obj().set("port", Json::num(1)).set("timeoutMs", Json::num(300)))?;
    let closed = !probe.get("open").and_then(|value| value.as_bool()).unwrap_or(true);
    checks.push(result_check("port-probe-closed-port", if closed { Ok(()) } else { Err("1 端口竟然开着".into()) }));

    let procs = win::process_snapshot()?;
    checks.push(result_check("proc-list", if procs.is_empty() { Err("进程列表是空的".into()) } else { Ok(()) }));

    let all_ok = checks.iter().all(|check| check.get("ok").and_then(|value| value.as_bool()).unwrap_or(false));
    Ok(Json::obj()
        .set("ok", Json::Bool(all_ok))
        .set("checks", Json::Arr(checks)))
}

fn result_check(name: &str, result: Result<(), String>) -> Json {
    let mut check = Json::obj().set("name", Json::str(name));
    check = match result {
        Ok(()) => check.set("ok", Json::Bool(true)),
        Err(error) => check.set("ok", Json::Bool(false)).set("error", Json::str(error)),
    };
    check
}

// ── 小工具 ──────────────────────────────────────────────────────────────

/// 深度优先走一棵目录树，对每个条目（含根之外的所有子孙）应用 op，返回成功数。
fn walk_apply(root: &str, op: &dyn Fn(&str) -> bool) -> usize {
    let mut ok = 0usize;
    let mut stack = vec![PathBuf::from(root)];
    while let Some(current) = stack.pop() {
        match std::fs::read_dir(&current) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if op(&path.to_string_lossy()) { ok += 1; }
                    if path.is_dir() { stack.push(path); }
                }
            }
            Err(_) => continue,
        }
    }
    ok
}

fn stamp_now() -> String {
    let bias = win::local_utc_bias_seconds() as i64;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let total = (now.as_secs() as i64 - bias).max(0) as u64;
    let (year, month, day, hour, minute, second) = epoch_to_local(total);
    format!("{:04}{:02}{:02}-{:02}{:02}{:02}", year, month, day, hour, minute, second)
}

fn iso_now() -> String {
    // 本地时间、无时区后缀：这是给人看的记录字段，不是跨机器对时的。
    let bias = win::local_utc_bias_seconds() as i64;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let total = (now.as_secs() as i64 - bias).max(0) as u64;
    let (year, month, day, hour, minute, second) = epoch_to_local(total);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}", year, month, day, hour, minute, second)
}

/// 本地时区的年月日时分秒。不做完整历法，用 days 累加法（1970-01-01 起）。
fn epoch_to_local(total: u64) -> (u64, u64, u64, u64, u64, u64) {
    let days = total / 86_400;
    let secs = total % 86_400;
    let mut year = 1970u64;
    let mut remaining = days;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let len = if leap { 366 } else { 365 };
        if remaining >= len { remaining -= len; year += 1; } else { break; }
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let month_lengths = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1u64;
    for length in month_lengths {
        if remaining >= length { remaining -= length; month += 1; } else { break; }
    }
    (year, month, remaining + 1, secs / 3600, (secs % 3600) / 60, secs % 60)
}
