//! doctor-sys：dsh-doctor 的底层原语引擎（设计文档 D1 / §9）。
//!
//! 协议：JSON over stdio，每个请求一个进程。
//!   请求（stdin 或命令行）：{"op":"acl-read","args":{"path":"C:\\..."}}
//!   响应（stdout）：        {"ok":true,"op":"acl-read","data":{...}}
//!                          {"ok":false,"op":"acl-read","error":"..."}
//!
//! 安全边界：没有 exec、没有 shell——原语表是封闭的动词表（docs/design.md §9）。
//! 注册表原语 v1 未实现（现有引擎用不到，宁缺毋滥）。

mod doctor;
mod json;
mod win;

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use json::Json;

const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), " (dsh-doctor doctor-sys)");

fn main() {
    std::process::exit(run_main());
}

fn run_main() -> i32 {
    let mut stdout = std::io::stdout();

    // 原生检查/修复子命令（scan / fix / version），其余参数仍走 JSON 原语协议。
    let argv: Vec<String> = std::env::args().collect();
    if argv.len() > 1 {
        match argv[1].as_str() {
            // help 是人类可读的命令行帮助；stdio 的 {"op":"help"} 仍返回单行 JSON。
            "scan" | "fix" | "version" | "--version" => return doctor::run(&argv),
            "help" | "--help" | "-h" => {
                println!("{}", USAGE);
                return 0;
            }
            _ => {}
        }
    }

    let (op, args) = match read_request() {
        Ok(parsed) => parsed,
        Err(error) => {
            let _ = writeln!(stdout, "{}", Json::obj()
                .set("ok", Json::Bool(false))
                .set("op", Json::str("request"))
                .set("error", Json::str(error))
                .serialize());
            return 2;
        }
    };

    let result = dispatch(&op, &args);
    // 0 = 原语成功，1 = 原语执行/自检失败，2 = 请求解析失败。
    let exit_code = match &result {
        Ok(data) if op == "selftest" && !selftest_passed(data) => 1,
        Ok(_) => 0,
        Err(_) => 1,
    };
    let response = match result {
        Ok(data) if op == "selftest" && !selftest_passed(&data) => Json::obj()
            .set("ok", Json::Bool(false))
            .set("op", Json::str(op))
            .set("error", Json::str("自检存在失败项，详见 data.checks"))
            .set("data", data),
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
    exit_code
}

fn selftest_passed(data: &Json) -> bool {
    data.get("ok").and_then(|value| value.as_bool()) == Some(true)
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
        Some(Json::Num(value)) if value.is_finite() && value.fract() == 0.0
            // JSON f64 在 i64 两端会舍入；保守拒绝最后两个可表示边界，绝不饱和窄化。
            && *value > i64::MIN as f64 && *value < i64::MAX as f64 => Ok(*value as i64),
        // CLI 与 stdio 都接受十进制整数字符串；拒绝小数、指数及静默截断。
        Some(Json::Str(text)) if !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()) => {
            text.parse::<i64>().map_err(|_| format!("参数 {} 超出整数范围：{}", key, text))
        }
        Some(Json::Str(text)) if text.starts_with('-') && text.len() > 1
            && text[1..].bytes().all(|byte| byte.is_ascii_digit()) => {
            text.parse::<i64>().map_err(|_| format!("参数 {} 超出整数范围：{}", key, text))
        }
        Some(Json::Str(text)) => Err(format!("参数 {} 不是十进制整数：{}", key, text)),
        _ => Err(format!("缺少或非法的数字参数 {}", key)),
    }
}

fn arg_number<T>(args: &Json, key: &str, min: i64, max: i64) -> Result<T, String>
where
    T: TryFrom<i64>,
{
    let value = arg_i64(args, key)?;
    if value < min || value > max {
        return Err(format!("参数 {} 超出范围 {}..={}：{}", key, min, max, value));
    }
    T::try_from(value).map_err(|_| format!("参数 {} 无法表示：{}", key, value))
}

fn arg_pid(args: &Json) -> Result<u32, String> {
    arg_number(args, "pid", 0, u32::MAX as i64)
}

fn arg_port(args: &Json) -> Result<u16, String> {
    arg_number(args, "port", 1, u16::MAX as i64)
}

fn arg_timeout_ms<T>(args: &Json, default: i64, max: i64) -> Result<T, String>
where
    T: TryFrom<i64>,
{
    match args.get("timeoutMs") {
        Some(_) => arg_number(args, "timeoutMs", 0, max),
        None => T::try_from(default).map_err(|_| format!("timeoutMs 默认值非法：{}", default)),
    }
}

// ── ACL 原语 ────────────────────────────────────────────────────────────

fn require_complete_sddl(sddl: String) -> Result<String, String> {
    if sddl.trim().is_empty() {
        Err("SDDL 转换返回空文本，未得到完整安全描述符".into())
    } else {
        Ok(sddl)
    }
}

fn op_acl_read(args: &Json) -> Result<Json, String> {
    let path = arg_str(args, "path")?;
    if !Path::new(&path).exists() {
        return Err(format!("路径不存在：{}", path));
    }
    let parts = win::get_named_security(&path)?;
    let info = win::OWNER_SECURITY_INFORMATION | win::GROUP_SECURITY_INFORMATION
        | win::DACL_SECURITY_INFORMATION | win::LABEL_SECURITY_INFORMATION;
    let sddl = match win::descriptor_to_sddl(parts.security_descriptor, info)
        .and_then(require_complete_sddl) {
        Ok(sddl) => sddl,
        Err(error) => {
            parts.drop();
            return Err(error);
        }
    };
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
    // recursive 用 (OI)(CI) 继承标志设置父目录，子项会自动继承，不再遍历整棵树
    // （桌面几千个文件逐个 SetNamedSecurityInfoW 会慢到不可接受）。
    // 需要覆盖子项已有的显式标签时，单独传 forceChildren。
    let force_children = arg_bool(args, "forceChildren");
    let mut changed = 1usize;
    win::set_integrity_label(&path, &label, recursive)?;
    if force_children {
        changed += walk_apply(&path, &|entry| win::set_integrity_label(entry, &label, false))?;
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
    let pid = arg_pid(args)?;
    let dry_run = arg_bool(args, "dryRun");
    let killed = win::kill_tree(pid, dry_run)?;
    let items = killed.iter().map(|value| Json::num(*value as i64)).collect();
    Ok(Json::obj()
        .set("pid", Json::num(pid as i64))
        .set("dryRun", Json::Bool(dry_run))
        .set("killed", Json::Arr(items)))
}

fn op_port_probe(args: &Json) -> Result<Json, String> {
    let port = arg_port(args)?;
    let host = args.get("host").and_then(|value| value.as_str()).unwrap_or("127.0.0.1").to_string();
    let timeout_ms: u64 = arg_timeout_ms(args, 1500, u32::MAX as i64)?;
    let address = (host.as_str(), port).to_socket_addrs()
        .map_err(|error| format!("地址解析失败：{}:{}（{}", host, port, error))?
        .next().ok_or("地址解析没有结果")?;
    let open = TcpStream::connect_timeout(&address, Duration::from_millis(timeout_ms)).is_ok();
    Ok(Json::obj().set("host", Json::str(host)).set("port", Json::num(port as i64)).set("open", Json::Bool(open)))
}

fn op_port_pid(args: &Json) -> Result<Json, String> {
    let port = arg_port(args)?;
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

#[derive(Debug)]
struct RestoreEntry {
    original: PathBuf,
    stored: PathBuf,
}

/// 只解析和预检，不创建备份目录、不改动任何 original。
fn prepare_restore_entries(snapshot_dir: &Path, entries: &[Json]) -> Result<Vec<RestoreEntry>, String> {
    let data_dir = snapshot_dir.join("data");
    let data_root = std::fs::canonicalize(&data_dir)
        .map_err(|error| format!("读快照 data 目录失败：{}（{}", data_dir.display(), error))?;
    if !data_root.is_dir() {
        return Err(format!("快照 data 不是目录：{}", data_root.display()));
    }

    let mut prepared = Vec::new();
    let mut errors = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let result = (|| -> Result<RestoreEntry, String> {
            let original = entry.get("original").and_then(|value| value.as_str()).ok_or("条目缺 original")?;
            let stored = entry.get("stored").and_then(|value| value.as_str()).ok_or("条目缺 stored")?;
            let original = PathBuf::from(original);
            if !original.is_absolute() {
                return Err(format!("original 必须是绝对路径：{}", original.display()));
            }

            // canonicalize 同时解析 .. 与符号链接，防止 data-evil、data/../x 和链接逃逸。
            // snapshot-write 的相对 stored 已包含 snapshotDir；裸 data/x 则相对 snapshotDir。
            let stored_path = PathBuf::from(stored);
            let stored_path = if stored_path.is_absolute() {
                stored_path
            } else {
                let direct = snapshot_dir.join(&stored_path);
                if stored_path.starts_with("data") && direct.exists() {
                    direct
                } else {
                    stored_path
                }
            };
            let stored = std::fs::canonicalize(&stored_path)
                .map_err(|error| format!("stored 不可读：{}（{}", stored_path.display(), error))?;
            if stored == data_root || !stored.starts_with(&data_root) {
                return Err(format!("stored 必须位于 {}/data 内：{}", snapshot_dir.display(), stored_path.display()));
            }
            check_readable_tree(&stored)?;
            check_optional_readable(&original)?;
            Ok(RestoreEntry { original, stored })
        })();
        match result {
            Ok(entry) => prepared.push(entry),
            Err(error) => errors.push(format!("条目 {}：{}", index, error)),
        }
    }
    if errors.is_empty() {
        Ok(prepared)
    } else {
        Err(format!("manifest 预检失败，未改动任何条目：{}", errors.join("；")))
    }
}

fn check_readable_tree(path: &Path) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path)
        .map_err(|error| format!("读 {} 失败：{}", path.display(), error))?;
    if meta.is_dir() {
        let entries = std::fs::read_dir(path)
            .map_err(|error| format!("列 {} 失败：{}", path.display(), error))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("遍历 {} 失败：{}", path.display(), error))?;
            check_readable_tree(&entry.path())?;
        }
    } else {
        std::fs::File::open(path)
            .map_err(|error| format!("文件不可读：{}（{}", path.display(), error))?;
    }
    Ok(())
}

fn check_optional_readable(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => check_readable_tree(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法检查 original：{}（{}", path.display(), error)),
    }
}

fn restore_backup_dir(snapshot_dir: &Path) -> PathBuf {
    let stamp = stamp_now();
    let base = format!("restore-backup-{}", stamp);
    let mut candidate = snapshot_dir.join(&base);
    let mut counter = 2usize;
    while candidate.exists() {
        candidate = snapshot_dir.join(format!("{}-{}", base, counter));
        counter += 1;
    }
    candidate
}

/// 删除必须显式成功；NotFound 才表示无需删除，其他错误不能吞掉。
fn remove_existing(path: &Path) -> Result<bool, String> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("检查待删除路径 {} 失败：{}", path.display(), error)),
    };
    if meta.is_dir() {
        std::fs::remove_dir_all(path).map_err(|error| format!("删除目录 {} 失败：{}", path.display(), error))?;
    } else {
        std::fs::remove_file(path).map_err(|error| format!("删除文件 {} 失败：{}", path.display(), error))?;
    }
    Ok(true)
}

/// 当前条目失败后的尽力回滚；备份保留，回滚错误也如实返回。
fn rollback_current(target: &Path, backup: &Path, originally_existed: bool) -> Result<(), String> {
    if originally_existed {
        remove_existing(target)?;
        copy_all(backup, target).map_err(|error| format!("从备份回滚 {} 失败：{}", target.display(), error))
    } else {
        remove_existing(target).map(|_| ())
    }
}

fn restore_entry(entry: &RestoreEntry, backup: &Path) -> Result<(), String> {
    let originally_existed = match std::fs::symlink_metadata(&entry.original) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("恢复前检查 {} 失败：{}", entry.original.display(), error)),
    };
    if originally_existed {
        copy_all(&entry.original, backup)
            .map_err(|error| format!("备份 {} 失败，未改动当前条目：{}", entry.original.display(), error))?;
    }

    let failure = match remove_existing(&entry.original) {
        Ok(_) => match copy_all(&entry.stored, &entry.original) {
            Ok(()) => return Ok(()),
            Err(error) => format!("复制快照到 {} 失败：{}", entry.original.display(), error),
        },
        Err(error) => format!("移走 {} 失败：{}", entry.original.display(), error),
    };

    match rollback_current(&entry.original, backup, originally_existed) {
        Ok(()) => Err(format!("{}；当前条目已尽力恢复原状", failure)),
        Err(rollback_error) => Err(format!("{}；回滚当前条目也失败：{}", failure, rollback_error)),
    }
}

fn restore_snapshot_entries(entries: &[RestoreEntry], backup_dir: &Path) -> (usize, Vec<String>) {
    let mut restored = 0usize;
    let mut errors = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let backup = backup_dir.join(format!("{:04}-{}", index, entry.original.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unnamed".into())));
        match restore_entry(entry, &backup) {
            Ok(()) => restored += 1,
            Err(error) => errors.push(format!("条目 {}：{}", index, error)),
        }
    }
    (restored, errors)
}

fn op_snapshot_restore(args: &Json) -> Result<Json, String> {
    let snapshot_dir = arg_str(args, "snapshotDir")?;
    let snapshot_path = Path::new(&snapshot_dir);
    let manifest_path = snapshot_path.join("manifest.json");
    let text = std::fs::read_to_string(&manifest_path)
        .map_err(|error| format!("读 manifest 失败：{}（{}", manifest_path.display(), error))?;
    let manifest = json::parse(&text).map_err(|error| format!("manifest 不是合法 JSON：{}", error))?;
    let entries = manifest.get("entries").and_then(|value| value.as_array()).ok_or("manifest 里没有 entries")?;
    let entries = prepare_restore_entries(snapshot_path, entries)?;
    let backup_dir = restore_backup_dir(snapshot_path);

    // 这不是全事务：逐条处理以收集更多错误；失败只回滚当前条目，先前成功项保持已恢复状态。
    let (restored, errors) = restore_snapshot_entries(&entries, &backup_dir);
    if !errors.is_empty() {
        return Err(format!(
            "恢复快照有 {} 个错误；已恢复 {}/{} 项（逐条处理，非全事务）；备份目录：{}；{}",
            errors.len(), restored, entries.len(), backup_dir.display(), errors.join("；"),
        ));
    }
    Ok(Json::obj()
        .set("restored", Json::num(restored as i64))
        .set("backupDir", Json::str(backup_dir.to_string_lossy().into_owned())))
}

// ── 通知原语 ────────────────────────────────────────────────────────────

fn op_notify(args: &Json) -> Result<Json, String> {
    let title = arg_str(args, "title")?;
    let body = arg_str(args, "body")?;
    let max_wait: u32 = arg_timeout_ms(args, 10_000, u32::MAX as i64)?;
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

    let acl_ok = selftest_acl_read();
    checks.push(result_check("acl-read", acl_ok));

    // 自检要跑完所有无风险检查并汇总，不能因一项失败就丢掉其余结果。
    let probe = op_port_probe(&Json::obj().set("port", Json::num(1)).set("timeoutMs", Json::num(300)))
        .and_then(|data| {
            if data.get("open").and_then(|value| value.as_bool()) == Some(false) {
                Ok(())
            } else {
                Err("1 端口竟然开着".into())
            }
        });
    checks.push(result_check("port-probe-closed-port", probe));

    let procs = win::process_snapshot().and_then(|entries| {
        if entries.is_empty() { Err("进程列表是空的".into()) } else { Ok(()) }
    });
    checks.push(result_check("proc-list", procs));

    let all_ok = checks.iter().all(|check| check.get("ok").and_then(|value| value.as_bool()).unwrap_or(false));
    Ok(Json::obj()
        .set("ok", Json::Bool(all_ok))
        .set("checks", Json::Arr(checks)))
}

fn selftest_acl_read() -> Result<(), String> {
    let file_name = format!("doctor-sys-selftest-{}.txt", std::process::id());
    let mut probe = std::env::temp_dir().join(&file_name);
    if std::fs::write(&probe, b"selftest").is_err() {
        // DSH 沙箱会拒绝写 %TEMP%（HANDOFF 5.6），退回当前目录。
        probe = std::env::current_dir()
            .map_err(|error| format!("拿当前目录失败：{}", error))?
            .join(&file_name);
    }
    let outcome = (|| -> Result<(), String> {
        std::fs::write(&probe, b"selftest").map_err(|error| format!("建临时文件失败：{}", error))?;
        let data = op_acl_read(&Json::obj().set("path", Json::str(probe.to_string_lossy().into_owned())))?;
        if data.get("sddl").and_then(|value| value.as_str()).map(|text| text.contains("D:")).unwrap_or(false) {
            Ok(())
        } else {
            Err("SDDL 里没有 DACL 段".into())
        }
    })();
    // 无论成功失败都清理：写入抛错、acl-read 失败也不会留垃圾文件。
    let _ = std::fs::remove_file(&probe);
    outcome
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

/// 深度优先处理根之外的子孙。遍历/操作失败全部收集，成功数绝不掩盖失败。
fn walk_apply(root: &str, op: &dyn Fn(&str) -> Result<(), String>) -> Result<usize, String> {
    let mut ok = 0usize;
    let mut errors = Vec::new();
    let mut stack = vec![PathBuf::from(root)];
    while let Some(current) = stack.pop() {
        match std::fs::read_dir(&current) {
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(entry) => {
                            let path = entry.path();
                            let display = path.to_string_lossy().into_owned();
                            match op(&display) {
                                Ok(()) => ok += 1,
                                Err(error) => errors.push(format!("{}：{}", display, error)),
                            }
                            if path.is_dir() { stack.push(path); }
                        }
                        Err(error) => errors.push(format!("遍历 {} 失败：{}", current.display(), error)),
                    }
                }
            }
            Err(error) => errors.push(format!("列目录 {} 失败：{}", current.display(), error)),
        }
    }
    if errors.is_empty() {
        Ok(ok)
    } else {
        Err(format!("{} 个子项成功，但有 {} 个失败：{}", ok, errors.len(), errors.join("；")))
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> TestDir {
            let sequence = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "doctor-sys-{}-{}-{}-{}", name, std::process::id(), sequence, stamp_now(),
            ));
            std::fs::create_dir_all(&path).unwrap();
            TestDir(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn args_with_number(value: Json) -> Json {
        Json::obj().set("pid", value.clone()).set("port", value.clone()).set("timeoutMs", value)
    }

    fn restore_json(original: &Path, stored: &Path) -> Json {
        Json::obj()
            .set("original", Json::str(original.to_string_lossy().into_owned()))
            .set("stored", Json::str(stored.to_string_lossy().into_owned()))
    }

    fn restore_json_text(original: &Path, stored: &str) -> Json {
        Json::obj()
            .set("original", Json::str(original.to_string_lossy().into_owned()))
            .set("stored", Json::str(stored))
    }

    #[test]
    fn numeric_strings_work_for_pid_port_and_timeout() {
        let values = args_with_number(Json::str("42"));
        assert_eq!(arg_pid(&values), Ok(42));
        assert_eq!(arg_port(&values), Ok(42));
        assert_eq!(arg_timeout_ms::<u32>(&values, 10, 100), Ok(42));

        let values = args_with_number(Json::str("65535"));
        assert_eq!(arg_port(&values), Ok(65535));
        let values = args_with_number(Json::str(u32::MAX.to_string()));
        assert_eq!(arg_pid(&values), Ok(u32::MAX));
        assert_eq!(arg_timeout_ms::<u32>(&values, 10, u32::MAX as i64), Ok(u32::MAX));
        assert_eq!(arg_timeout_ms::<u32>(&Json::obj(), 10, 100), Ok(10));
    }

    #[test]
    fn numeric_arguments_reject_negative_fraction_and_narrowing() {
        for text in ["-1", "1.5", "1e3", "", "12x", "+1", "999999999999999999999"] {
            let values = args_with_number(Json::str(text));
            assert!(arg_pid(&values).is_err(), "pid accepted {:?}", text);
            assert!(arg_port(&values).is_err(), "port accepted {:?}", text);
            assert!(arg_timeout_ms::<u32>(&values, 10, 100).is_err(), "timeout accepted {:?}", text);
        }
        let values = args_with_number(Json::Num(12.75));
        assert!(arg_pid(&values).is_err());
        assert!(arg_port(&values).is_err());
        assert!(arg_timeout_ms::<u32>(&values, 10, 100).is_err());
        assert!(arg_port(&args_with_number(Json::num(0))).is_err());
        assert!(arg_port(&args_with_number(Json::num(65_536))).is_err());
        assert!(arg_i64(&Json::obj().set("pid", Json::Num(i64::MIN as f64)), "pid").is_err());
        assert!(arg_i64(&Json::obj().set("pid", Json::Num(i64::MAX as f64)), "pid").is_err());
        assert!(arg_pid(&args_with_number(Json::str((u64::from(u32::MAX) + 1).to_string()))).is_err());
        assert!(arg_timeout_ms::<u32>(&args_with_number(Json::num(-1)), 10, 100).is_err());
    }

    #[test]
    fn empty_sddl_and_failed_selftest_are_failures() {
        assert!(require_complete_sddl(String::new()).is_err());
        assert!(require_complete_sddl(" \r\n".into()).is_err());
        assert_eq!(require_complete_sddl("O:WD".into()).unwrap(), "O:WD");
        assert!(!selftest_passed(&Json::obj().set("ok", Json::Bool(false))));
        assert!(selftest_passed(&Json::obj().set("ok", Json::Bool(true))));
    }

    #[test]
    fn force_children_walk_returns_errors_after_processing_all_entries() {
        let temp = TestDir::new("walk");
        std::fs::write(temp.path().join("one"), b"1").unwrap();
        std::fs::write(temp.path().join("two"), b"2").unwrap();
        let calls = Cell::new(0usize);
        let result = walk_apply(&temp.path().to_string_lossy(), &|path| {
            calls.set(calls.get() + 1);
            if path.ends_with("one") { Err("child failed".into()) } else { Ok(()) }
        });
        let error = result.unwrap_err();
        assert_eq!(calls.get(), 2);
        assert!(error.contains("child failed"));
        assert!(error.contains("1 个子项成功"));
    }

    #[test]
    fn restore_validation_rejects_escape_and_relative_original() {
        let temp = TestDir::new("manifest");
        let snapshot = temp.path().join("snapshot");
        let data = snapshot.join("data");
        std::fs::create_dir_all(&data).unwrap();
        let stored = data.join("inside.txt");
        std::fs::write(&stored, b"snapshot").unwrap();
        let outside = temp.path().join("outside.txt");
        std::fs::write(&outside, b"outside").unwrap();

        let entries = vec![
            restore_json(Path::new("relative.txt"), &stored),
            restore_json(&temp.path().join("keep.txt"), &outside),
        ];
        let error = prepare_restore_entries(&snapshot, &entries).unwrap_err();
        assert!(error.contains("条目 0"));
        assert!(error.contains("条目 1"));
        assert!(error.contains("未改动任何条目"));
    }

    #[test]
    fn restore_validation_rejects_dotdot_even_with_containing_snapshot_prefix() {
        let temp = TestDir::new("dotdot");
        let snapshot = temp.path().join("nested").join("snapshot");
        let data = snapshot.join("data");
        std::fs::create_dir_all(&data).unwrap();
        let outside = temp.path().join("nested").join("outside.txt");
        std::fs::write(&outside, b"outside").unwrap();
        let entry = restore_json_text(
            &temp.path().join("keep.txt"),
            &format!("{}/../outside.txt", snapshot.display()),
        );
        let error = prepare_restore_entries(&snapshot, &[entry]).unwrap_err();
        assert!(error.contains("stored 必须位于"));
    }

    #[test]
    fn restore_validation_accepts_snapshot_relative_data_path() {
        let temp = TestDir::new("data-relative");
        let snapshot = temp.path().join("snapshot");
        let data = snapshot.join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("stored.txt"), b"snapshot").unwrap();
        let original = temp.path().join("original.txt");
        let entry = restore_json_text(&original, "data/stored.txt");
        let prepared = prepare_restore_entries(&snapshot, &[entry]).unwrap();
        assert_eq!(prepared.len(), 1);
        assert_eq!(prepared[0].stored, std::fs::canonicalize(data.join("stored.txt")).unwrap());
    }

    #[test]
    fn remove_missing_is_ok_but_other_remove_failures_are_returned() {
        let temp = TestDir::new("remove");
        assert_eq!(remove_existing(&temp.path().join("missing")), Ok(false));
        let file = temp.path().join("file");
        std::fs::write(&file, b"before").unwrap();
        assert_eq!(remove_existing(&file), Ok(true));
        assert!(!file.exists());
    }

    #[test]
    fn rollback_restores_existing_target_or_removes_partial_new_target() {
        let temp = TestDir::new("rollback");
        let target = temp.path().join("target");
        let backup = temp.path().join("backup");
        std::fs::write(&target, b"partial").unwrap();
        std::fs::write(&backup, b"before").unwrap();
        rollback_current(&target, &backup, true).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"before");

        let new_target = temp.path().join("new-target");
        std::fs::write(&new_target, b"partial").unwrap();
        rollback_current(&new_target, &temp.path().join("unused"), false).unwrap();
        assert!(!new_target.exists());
    }

    #[test]
    fn restore_rolls_back_failed_entry_and_continues() {
        let temp = TestDir::new("restore");
        let snapshot = temp.path().join("snapshot");
        let data = snapshot.join("data");
        std::fs::create_dir_all(&data).unwrap();
        let first_stored = data.join("first.txt");
        let second_stored = data.join("second.txt");
        let second_target = temp.path().join("second.txt");
        std::fs::write(&first_stored, b"before").unwrap();
        std::fs::write(&second_stored, b"restored").unwrap();
        std::fs::write(&second_target, b"current").unwrap();

        // original == stored 让预检成功、删除后复制失败，借此无权限修改地验证真实回滚路径。
        let entries = vec![
            restore_json(&first_stored, &first_stored),
            restore_json(&second_target, &second_stored),
        ];
        let entries = prepare_restore_entries(&snapshot, &entries).unwrap();
        let (restored, errors) = restore_snapshot_entries(&entries, &snapshot.join("backup"));
        assert_eq!(restored, 1);
        assert_eq!(errors.len(), 1);
        assert_eq!(std::fs::read(&first_stored).unwrap(), b"before");
        assert_eq!(std::fs::read(&second_target).unwrap(), b"restored");
    }

    #[test]
    fn unreadable_later_entry_aborts_before_any_restore() {
        let temp = TestDir::new("preflight");
        let snapshot = temp.path().join("snapshot");
        let data = snapshot.join("data");
        std::fs::create_dir_all(&data).unwrap();
        let stored = data.join("good.txt");
        let target = temp.path().join("target.txt");
        std::fs::write(&stored, b"snapshot").unwrap();
        std::fs::write(&target, b"current").unwrap();
        let missing = data.join("missing.txt");
        let entries = vec![
            restore_json(&target, &stored),
            restore_json(&temp.path().join("other.txt"), &missing),
        ];
        assert!(prepare_restore_entries(&snapshot, &entries).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"current");
    }
}
