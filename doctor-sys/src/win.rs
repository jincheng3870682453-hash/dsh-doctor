//! Win32 FFI：doctor-sys 用到的全部系统调用，零第三方依赖。
//!
//! 约定：所有函数返回 Result<T, String>，错误文本带 GetLastError 的系统消息，
//! 引擎层（main.rs）只负责把 Result 变成 JSON 响应。
#![allow(non_snake_case, non_camel_case_types, dead_code)]

use std::ffi::c_void;
use std::ptr;

use crate::json::Json;

// ── 常量 ────────────────────────────────────────────────────────────────

const ERROR_SUCCESS: u32 = 0;
const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
const ERROR_INVALID_OWNER: u32 = 1307;
const ERROR_PRIVILEGE_NOT_HELD: u32 = 1314;

const SE_FILE_OBJECT: u32 = 1;
pub const OWNER_SECURITY_INFORMATION: u32 = 0x0000_0001;
pub const GROUP_SECURITY_INFORMATION: u32 = 0x0000_0002;
pub const DACL_SECURITY_INFORMATION: u32 = 0x0000_0004;
pub const SACL_SECURITY_INFORMATION: u32 = 0x0000_0008;
pub const LABEL_SECURITY_INFORMATION: u32 = 0x0000_0010;
const SDDL_REVISION_1: u32 = 1;
const ACL_REVISION_DS: u32 = 4;
const ACL_SIZE_INFORMATION_CLASS: u32 = 2;

const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
const PROCESS_TERMINATE: u32 = 0x0001;
const INVALID_HANDLE_VALUE: isize = -1;

const AF_INET: u32 = 2;
// TCP_TABLE_CLASS：0=BASIC_LISTENER 1=BASIC_CONNECTIONS 2=BASIC_ALL 3=OWNER_PID_LISTENER …
// 用 2 会拿到没有 pid 字段的 MIB_TCPTABLE，行结构错位。
const TCP_TABLE_OWNER_PID_LISTENER: u32 = 3;
const MIB_TCP_STATE_LISTEN: u32 = 2;

const SHCNE_UPDATEDIR: i32 = 0x0000_1000;
const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
const SHCNF_IDLIST: u32 = 0x0000;
const SHCNF_PATHW: u32 = 0x0005;

const NIM_ADD: u32 = 0;
const NIM_DELETE: u32 = 2;
const NIF_MESSAGE: u32 = 0x0001;
const NIF_INFO: u32 = 0x0010;
const NIIF_INFO: u32 = 0x0001;
const NIIF_RESPECT_QUIET_TIME: u32 = 0x0080;

const WM_DESTROY: u32 = 0x0002;
const WM_TIMER: u32 = 0x0113;
const WM_APP: u32 = 0x8000;
const NIN_BALLOONHIDE: isize = WM_APP as isize + 3;
const NIN_BALLOONTIMEOUT: isize = WM_APP as isize + 4;
const NIN_BALLOONUSERCLICK: isize = WM_APP as isize + 5;

// ── 结构体（布局与 Windows SDK 头文件一致，repr(C) 保证填充规则相同）────

#[repr(C)]
#[derive(Clone, Copy)]
struct GUID { data1: u32, data2: u16, data3: u16, data4: [u8; 8] }

#[repr(C)]
struct ACL_HEADER { acl_revision: u8, sbz1: u8, acl_size: u16, ace_count: u16, sbz2: u16 }

#[repr(C)]
struct ACL_SIZE_INFORMATION { acl_bytes_in_use: u32, acl_bytes_free: u32, acl_bytes_used: u32 }

#[repr(C)]
struct ACE_HEADER { ace_type: u8, ace_flags: u8, ace_size: u16 }

#[repr(C)]
struct ACCESS_DENIED_ACE { header: ACE_HEADER, mask: u32, sid_start: [u8; 4] }

#[repr(C)]
struct PROCESSENTRY32W {
    dw_size: u32,
    cnt_usage: u32,
    th32_process_id: u32,
    th32_default_heap_id: usize,
    th32_module_id: u32,
    cnt_threads: u32,
    th32_parent_process_id: u32,
    pc_pri_class_base: i32,
    dw_flags: u32,
    sz_exe_file: [u16; 260],
}

#[repr(C)]
struct MIB_TCPROW_OWNER_PID {
    dw_state: u32,
    dw_local_addr: u32,
    dw_local_port: u32,
    dw_remote_addr: u32,
    dw_remote_port: u32,
    dw_owning_pid: u32,
}

#[repr(C)]
struct MIB_TCPTABLE_OWNER_PID { dw_num_entries: u32, table: [MIB_TCPROW_OWNER_PID; 1] }

#[repr(C)]
#[derive(Clone, Copy)]
struct POINT { x: i32, y: i32 }

#[repr(C)]
struct MSG {
    hwnd: isize,
    message: u32,
    w_param: usize,
    l_param: isize,
    time: u32,
    pt: POINT,
}

#[repr(C)]
struct WNDCLASSEXW {
    cb_size: u32,
    style: u32,
    lpfn_wnd_proc: Option<unsafe extern "system" fn(isize, u32, usize, isize) -> isize>,
    cb_clsextra: i32,
    cb_wndextra: i32,
    h_instance: isize,
    h_icon: isize,
    h_cursor: isize,
    h_brush_background: isize,
    lpsz_menu_name: *const u16,
    lpsz_class_name: *const u16,
    h_icon_sm: isize,
}

#[repr(C)]
union NOTIFYICONDATA_U { u_timeout: u32, u_version: u32 }

#[repr(C)]
struct NOTIFYICONDATAW {
    cb_size: u32,
    hwnd: isize,
    u_id: u32,
    u_flags: u32,
    u_callback_message: u32,
    h_icon: isize,
    sz_tip: [u16; 128],
    dw_state: u32,
    dw_state_mask: u32,
    sz_info: [u16; 256],
    u: NOTIFYICONDATA_U,
    sz_info_title: [u16; 64],
    dw_info_flags: u32,
    guid_item: GUID,
    h_balloon_icon: isize,
}

// ── 外部函数声明 ────────────────────────────────────────────────────────

#[link(name = "advapi32")]
extern "system" {
    fn GetNamedSecurityInfoW(
        p_object_name: *const u16, object_type: u32, security_info: u32,
        pp_sid_owner: *mut *mut c_void, pp_sid_group: *mut *mut c_void,
        pp_dacl: *mut *mut c_void, pp_sacl: *mut *mut c_void,
        pp_security_descriptor: *mut *mut c_void,
    ) -> u32;
    fn SetNamedSecurityInfoW(
        p_object_name: *const u16, object_type: u32, security_info: u32,
        psid_owner: *const c_void, psid_group: *const c_void,
        p_dacl: *const c_void, p_sacl: *const c_void,
    ) -> u32;
    fn ConvertSecurityDescriptorToStringSecurityDescriptorW(
        security_descriptor: *const c_void, requested_string_sd_revision: u32,
        security_information: u32, string_security_descriptor: *mut *mut u16,
        string_security_descriptor_len: *mut u32,
    ) -> i32;
    fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
        string_security_descriptor: *const u16, string_sd_revision: u32,
        security_descriptor: *mut *mut c_void, security_descriptor_len: *mut u32,
    ) -> i32;
    fn GetSecurityDescriptorOwner(p_sd: *const c_void, p_owner: *mut *mut c_void, lpb_owner_defaulted: *mut i32) -> i32;
    fn GetSecurityDescriptorGroup(p_sd: *const c_void, p_group: *mut *mut c_void, lpb_group_defaulted: *mut i32) -> i32;
    fn GetSecurityDescriptorDacl(p_sd: *const c_void, lpb_dacl_present: *mut i32, p_dacl: *mut *mut c_void, lpb_dacl_defaulted: *mut i32) -> i32;
    fn GetSecurityDescriptorSacl(p_sd: *const c_void, lpb_sacl_present: *mut i32, p_sacl: *mut *mut c_void, lpb_sacl_defaulted: *mut i32) -> i32;
    fn ConvertSidToStringSidW(sid: *const c_void, string_sid: *mut *mut u16) -> i32;
    fn GetAclInformation(pacl: *const c_void, pacl_information: *mut c_void, n_acl_information_length: u32, dw_acl_information_class: u32) -> i32;
    fn GetAce(pacl: *const c_void, dw_ace_index: u32, pace: *mut *mut c_void) -> i32;
    fn AddAce(pacl: *mut c_void, dw_ace_revision: u32, dw_ace_index: u32, pace: *const c_void, n_ace_size: u32) -> i32;
    fn InitializeAcl(pacl: *mut c_void, n_acl_length: u32, dw_acl_revision: u32) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(hmem: *mut c_void) -> *mut c_void;
    fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> isize;
    fn Process32FirstW(h_snapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
    fn Process32NextW(h_snapshot: isize, lppe: *mut PROCESSENTRY32W) -> i32;
    fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> isize;
    fn TerminateProcess(h_process: isize, u_exit_code: u32) -> i32;
    fn CloseHandle(h_object: isize) -> i32;
    fn GetCurrentProcessId() -> u32;
    fn GetModuleHandleW(lp_module_name: *const u16) -> isize;
    fn GetTimeZoneInformation(lptimezoneinformation: *mut TIME_ZONE_INFORMATION) -> u32;
    fn FormatMessageW(
        dw_flags: u32, lp_source: *const c_void, dw_message_id: u32, dw_language_id: u32,
        lp_buffer: *mut u16, n_size: u32, arguments: *mut c_void,
    ) -> u32;
}

#[repr(C)]
struct TIME_ZONE_INFORMATION {
    bias: i32,
    standard_name: [u16; 32],
    standard_date: SYSTEMTIME,
    standard_bias: i32,
    daylight_name: [u16; 32],
    daylight_date: SYSTEMTIME,
    daylight_bias: i32,
}

#[repr(C)]
struct SYSTEMTIME { w_year: u16, w_month: u16, w_day_of_week: u16, w_day: u16, w_hour: u16, w_minute: u16, w_second: u16, w_milliseconds: u16 }

/// 本地时间与 UTC 的偏差（秒）。本地 = UTC - bias。
pub fn local_utc_bias_seconds() -> i64 {
    unsafe {
        let mut zone: TIME_ZONE_INFORMATION = std::mem::zeroed();
        let state = GetTimeZoneInformation(&mut zone);
        // TIME_ZONE_ID_DAYLIGHT = 2 时用夏令时增量，否则用标准增量（多数时区为 0）。
        let extra = if state == 2 { zone.daylight_bias } else { zone.standard_bias };
        (zone.bias as i64 + extra as i64) * 60
    }
}

#[link(name = "iphlpapi")]
extern "system" {
    fn GetExtendedTcpTable(
        p_tcp_table: *mut c_void, pdw_size: *mut u32, b_order: i32,
        ul_af: u32, table_class: u32, reserved: u32,
    ) -> u32;
}

#[link(name = "shell32")]
extern "system" {
    fn SHChangeNotify(w_event_id: i32, u_flags: u32, dw_item1: *const c_void, dw_item2: *const c_void);
    fn Shell_NotifyIconW(dw_message: u32, lpdata: *mut NOTIFYICONDATAW) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn RegisterClassExW(lpwcx: *const WNDCLASSEXW) -> u16;
    fn CreateWindowExW(
        dw_ex_style: u32, lp_class_name: *const u16, lp_window_name: *const u16, dw_style: u32,
        x: i32, y: i32, n_width: i32, n_height: i32, hwnd_parent: isize, h_menu: isize,
        h_instance: isize, lp_param: *mut c_void,
    ) -> isize;
    fn DefWindowProcW(hwnd: isize, msg: u32, w_param: usize, l_param: isize) -> isize;
    fn GetMessageW(lp_msg: *mut MSG, hwnd: isize, w_msg_filter_min: u32, w_msg_filter_max: u32) -> i32;
    fn TranslateMessage(lp_msg: *const MSG) -> i32;
    fn DispatchMessageW(lp_msg: *const MSG) -> isize;
    fn PostQuitMessage(exit_code: i32);
    fn SetTimer(hwnd: isize, n_id_event: usize, u_elapse: u32, lp_timer_func: *mut c_void) -> usize;
    fn KillTimer(hwnd: isize, u_id_event: usize) -> i32;
    fn DestroyWindow(hwnd: isize) -> i32;
    fn UnregisterClassW(lp_class_name: *const u16, h_instance: isize) -> i32;
    fn LoadIconW(h_instance: isize, lp_icon_name: *const u16) -> isize;
}

const IDI_APPLICATION: *const u16 = 32512 as *const u16;
const NIF_ICON: u32 = 0x0002;

const FORMAT_MESSAGE_FROM_SYSTEM: u32 = 0x0100;
const FORMAT_MESSAGE_IGNORE_INSERTS: u32 = 0x0200;

// ── 基础工具 ────────────────────────────────────────────────────────────

pub fn to_wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn from_wide(mut wide: &[u16]) -> String {
    if let Some(end) = wide.iter().position(|&ch| ch == 0) {
        wide = &wide[..end];
    }
    String::from_utf16_lossy(wide)
}

fn write_u16_array(target: &mut [u16], text: &str) {
    for (slot, ch) in target.iter_mut().zip(text.encode_utf16()) {
        *slot = ch;
    }
}

/// GetLastError 的系统消息；拿不到就只给错误码。
pub fn last_error(context: &str) -> String {
    let code = unsafe { GetLastErrorStub() };
    let mut buffer = [0u16; 512];
    let len = unsafe {
        FormatMessageW(
            FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
            ptr::null(), code, 0,
            buffer.as_mut_ptr(), buffer.len() as u32, ptr::null_mut(),
        )
    };
    let message = if len > 0 { from_wide(&buffer[..len as usize]) } else { String::new() };
    format!("{}（Win32 错误 {}：{}）", context, code, message.trim())
}

// GetLastError 必须紧跟失败调用读取；这里经由下面的 take_last_error 包装。
extern "system" {
    #[link_name = "GetLastError"]
    fn GetLastErrorStub() -> u32;
}

/// 在 unsafe 块里调用 Win32 后立刻用它换 Result，避免中途污染LastError。
macro_rules! check {
    ($expr:expr, $context:expr) => {
        if $expr { Ok(()) } else { Err(last_error($context)) }
    };
}

pub type c_result<T> = Result<T, String>;

// ── ACL / 安全描述符 ────────────────────────────────────────────────────

pub struct DescriptorParts {
    pub security_descriptor: *mut c_void,
    pub owner: *mut c_void,
    pub group: *mut c_void,
    pub dacl: *mut c_void,
    pub sacl: *mut c_void,
}

impl DescriptorParts {
    pub fn drop(self) {
        unsafe { LocalFree(self.security_descriptor) };
    }
}

pub fn get_named_security(path: &str) -> c_result<DescriptorParts> {
    let wide = to_wide(path);
    let mut parts = DescriptorParts {
        security_descriptor: ptr::null_mut(),
        owner: ptr::null_mut(),
        group: ptr::null_mut(),
        dacl: ptr::null_mut(),
        sacl: ptr::null_mut(),
    };
    let info = OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION
        | DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION;
    let result = unsafe {
        GetNamedSecurityInfoW(
            wide.as_ptr(), SE_FILE_OBJECT, info,
            &mut parts.owner, &mut parts.group, &mut parts.dacl, &mut parts.sacl,
            &mut parts.security_descriptor,
        )
    };
    if result != ERROR_SUCCESS {
        // SACL（审计项）读取需要 SeSecurityPrivilege；去掉 SACL/LABEL 再试，标签单独取。
        let mut fallback = DescriptorParts {
            security_descriptor: ptr::null_mut(),
            owner: ptr::null_mut(),
            group: ptr::null_mut(),
            dacl: ptr::null_mut(),
            sacl: ptr::null_mut(),
        };
        let info = OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
        let retry = unsafe {
            GetNamedSecurityInfoW(
                wide.as_ptr(), SE_FILE_OBJECT, info,
                &mut fallback.owner, &mut fallback.group, &mut fallback.dacl, &mut fallback.sacl,
                &mut fallback.security_descriptor,
            )
        };
        if retry != ERROR_SUCCESS {
            return Err(format!("读取安全描述符失败：{}（Win32 错误 {}）", path, retry));
        }
        return Ok(fallback);
    }
    Ok(parts)
}

pub fn descriptor_to_sddl(descriptor: *const c_void, info: u32) -> c_result<String> {
    let mut string_ptr: *mut u16 = ptr::null_mut();
    let mut string_len: u32 = 0;
    let ok = unsafe {
        ConvertSecurityDescriptorToStringSecurityDescriptorW(
            descriptor, SDDL_REVISION_1, info, &mut string_ptr, &mut string_len,
        )
    };
    if ok == 0 {
        return Err(last_error("SDDL 转换失败"));
    }
    let text = unsafe { from_wide(std::slice::from_raw_parts(string_ptr, string_len as usize)) };
    unsafe { LocalFree(string_ptr as *mut c_void) };
    Ok(text)
}

pub fn sddl_to_descriptor(sddl: &str) -> c_result<*mut c_void> {
    let wide = to_wide(sddl);
    let mut descriptor: *mut c_void = ptr::null_mut();
    let mut descriptor_len: u32 = 0;
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide.as_ptr(), SDDL_REVISION_1, &mut descriptor, &mut descriptor_len,
        )
    };
    if ok == 0 {
        return Err(format!("SDDL 无法解析：{}（{}", sddl, last_error("转换失败")));
    }
    Ok(descriptor)
}

pub fn sid_to_string(sid: *const c_void) -> c_result<String> {
    let mut string_ptr: *mut u16 = ptr::null_mut();
    let ok = unsafe { ConvertSidToStringSidW(sid, &mut string_ptr) };
    if ok == 0 {
        return Err(last_error("SID 转字符串失败"));
    }
    // 长度未知，逐字符找到 NUL：
    let mut len = 0usize;
    unsafe {
        while *string_ptr.add(len) != 0 { len += 1; }
    }
    let text = unsafe { from_wide(std::slice::from_raw_parts(string_ptr, len)) };
    unsafe { LocalFree(string_ptr as *mut c_void) };
    Ok(text)
}

/// 从安全描述符里拆出 owner / group / dacl / sacl（不夺所有权，descriptor 仍由调用者释放）。
pub fn split_descriptor(descriptor: *mut c_void) -> c_result<DescriptorParts> {
    let mut owner: *mut c_void = ptr::null_mut();
    let mut group: *mut c_void = ptr::null_mut();
    let mut dacl: *mut c_void = ptr::null_mut();
    let mut sacl: *mut c_void = ptr::null_mut();
    let mut present: i32 = 0;
    let mut defaulted: i32 = 0;
    unsafe {
        check!(GetSecurityDescriptorOwner(descriptor, &mut owner, &mut defaulted) != 0, "读 owner 失败")?;
        check!(GetSecurityDescriptorGroup(descriptor, &mut group, &mut defaulted) != 0, "读 group 失败")?;
        check!(GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted) != 0, "读 DACL 失败")?;
        check!(GetSecurityDescriptorSacl(descriptor, &mut present, &mut sacl, &mut defaulted) != 0, "读 SACL 失败")?;
    }
    Ok(DescriptorParts { security_descriptor: descriptor, owner, group, dacl, sacl })
}

fn set_named_security_info(
    path: &str, info: u32,
    owner: *const c_void, group: *const c_void,
    dacl: *const c_void, sacl: *const c_void,
) -> c_result<()> {
    let wide = to_wide(path);
    let result = unsafe {
        SetNamedSecurityInfoW(wide.as_ptr(), SE_FILE_OBJECT, info, owner, group, dacl, sacl)
    };
    if result != ERROR_SUCCESS {
        return Err(format!("写安全描述符失败：{}（Win32 错误 {}）", path, result));
    }
    Ok(())
}

/// 把整份 SDDL 写回路径。owner 需要 SeTakeOwnershipPrivilege、SACL 需要SeSecurityPrivilege，
/// 普通用户大概率两样都没有，所以按全量 → 去 owner/group → 只 DACL 逐级降级。
///
/// 两条实测出的硬规则（DSH 沙箱 / 普通桌面一致）：
///   1. SACL 传 NULL 时 SetNamedSecurityInfoW 报 1299（ERROR_INVALID_LABEL）——
///      所以永远随行一个标签：备份有标签用备份的；没有就沿用当前标签；
///      连当前都没有就带 medium（等于"无显式标签"的系统默认）。
///   2. 带 NULL 指针声明 DACL 位会被当成"清成空 DACL（全员完全访问）"——
///      权限位只在 SDDL 里有该段且指针非空时才声明。
pub fn restore_sddl(path: &str, sddl: &str) -> c_result<String> {
    let descriptor = sddl_to_descriptor(sddl)?;
    let parts = split_descriptor(descriptor)?;
    let mut extra_free: Vec<*mut c_void> = vec![descriptor];

    let backup_has_label = sddl.contains("(ML") && !parts.sacl.is_null();
    let sacl = if backup_has_label {
        parts.sacl
    } else {
        // 备份没标签：沿用当前标签；当前也没有就用 medium。
        let current = get_named_security(path)?;
        extra_free.push(current.security_descriptor);
        if !current.sacl.is_null() {
            current.sacl
        } else {
            let medium = sddl_to_descriptor("S:(ML;;NW;;;ME)")?;
            extra_free.push(medium);
            split_descriptor(medium)?.sacl
        }
    };

    let mut sections = 0;
    if sddl.starts_with("O:") && !parts.owner.is_null() { sections |= OWNER_SECURITY_INFORMATION; }
    if sddl.contains("G:") && !parts.group.is_null() { sections |= GROUP_SECURITY_INFORMATION; }
    if sddl.contains("D:") && !parts.dacl.is_null() { sections |= DACL_SECURITY_INFORMATION; }
    if !sacl.is_null() { sections |= LABEL_SECURITY_INFORMATION; }

    let mut applied = String::new();
    let outcome = if sections == 0 {
        Err("备份里没有可写的内容".into())
    } else if set_named_security_info(path, sections, parts.owner, parts.group, parts.dacl, sacl).is_ok() {
        let names = [
            ("owner", sections & OWNER_SECURITY_INFORMATION != 0),
            ("group", sections & GROUP_SECURITY_INFORMATION != 0),
            ("dacl", sections & DACL_SECURITY_INFORMATION != 0),
            ("label", true),
        ];
        applied = names.iter().filter(|(_, on)| *on).map(|(name, _)| *name).collect::<Vec<_>>().join("+");
        Ok(())
    } else {
        // owner / group 写不动（1307）：去掉再试。
        let mut dacl_bits = 0;
        if !parts.dacl.is_null() { dacl_bits |= DACL_SECURITY_INFORMATION; }
        if !sacl.is_null() { dacl_bits |= LABEL_SECURITY_INFORMATION; }
        if dacl_bits != 0 && set_named_security_info(path, dacl_bits, ptr::null(), ptr::null(), parts.dacl, sacl).is_ok() {
            applied = if backup_has_label { "dacl+label" } else { "dacl" }.to_string();
            applied.push_str("（owner/group 没权限写，跳过）");
            Ok(())
        } else if !parts.dacl.is_null() {
            set_named_security_info(path, DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION, ptr::null(), ptr::null(), parts.dacl, sacl)
                .map(|_| { applied = "dacl+label（owner/group 都没权限写）".into(); })
        } else {
            Err("owner/group 与 DACL 都写不进去".into())
        }
    };
    for block in extra_free {
        unsafe { LocalFree(block) };
    }
    outcome.map(|_| applied)
}

/// 构造完整性标签的 SACL SDDL。recursive = (OI)(CI) 继承到子项。
pub fn integrity_label_sddl(label: &str, recursive: bool) -> c_result<String> {
    let sid = match label.to_ascii_lowercase().as_str() {
        "low" => "LW",
        "medium" => "ME",
        "high" => "HI",
        other => return Err(format!("未知完整性标签 '{}'（可用：low / medium / high）", other)),
    };
    let flags = if recursive { "CIOI" } else { "" };
    Ok(format!("S:(ML;{};NW;;;{})", flags, sid))
}

pub fn set_integrity_label(path: &str, label: &str, recursive: bool) -> c_result<()> {
    let sddl = integrity_label_sddl(label, recursive)?;
    let descriptor = sddl_to_descriptor(&sddl)?;
    let parts = split_descriptor(descriptor)?;
    let result = set_named_security_info(path, LABEL_SECURITY_INFORMATION, ptr::null(), ptr::null(), ptr::null(), parts.sacl);
    unsafe { LocalFree(descriptor) };
    result
}

/// 从完整 SDDL 文本里认出完整性标签（S: 段的 ML ACE，SID 是 LW/ME/HI）。
pub fn label_from_sddl(sddl: &str) -> Option<&'static str> {
    let s_section = sddl.split('(').find(|part| part.starts_with("ML;"))?;
    if s_section.contains(";;;LW)") { Some("low") }
    else if s_section.contains(";;;ME)") { Some("medium") }
    else if s_section.contains(";;;HI)") { Some("high") }
    else { None }
}

/// 删除 DACL 里属于指定 SID 的拒绝 ACE（例如桌面上 Everyone 的拒绝删除项）。
/// 其余 ACE 原顺序保留。返回删掉的数量。
///
/// 实现：不走 InitializeAcl+AddAce（对继承型 ACE 组合会报 122），直接在
/// 旧 ACL 的字节流上做"紧凑拷贝"——头部 8 字节原样保留（含 revision），
/// 保留的 ACE 按原顺序紧挨着排，最后改掉头部里的 ace_count / acl_size。
pub fn remove_deny_aces(path: &str, sid: &str) -> c_result<usize> {
    let parts = get_named_security(path)?;
    if parts.dacl.is_null() {
        parts.drop();
        return Ok(0);
    }
    unsafe {
        let acl = parts.dacl as *const u8;
        let mut size_info = ACL_SIZE_INFORMATION { acl_bytes_in_use: 0, acl_bytes_free: 0, acl_bytes_used: 0 };
        check!(
            GetAclInformation(acl as *const c_void, &mut size_info as *mut _ as *mut c_void,
                std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32, ACL_SIZE_INFORMATION_CLASS) != 0,
            "读 ACL 信息失败"
        )?;
        let ace_count = (*(acl as *const ACL_HEADER)).ace_count as usize;

        let target = sid.to_ascii_uppercase();
        let mut buffer: Vec<u8> = Vec::with_capacity(size_info.acl_bytes_in_use as usize);
        let header = std::slice::from_raw_parts(acl, 8).to_vec();
        buffer.extend_from_slice(&header);
        let mut removed = 0usize;

        let mut cursor = 8usize;
        for _ in 0..ace_count {
            let header = acl.add(cursor) as *const ACE_HEADER;
            let ace_size = (*header).ace_size as usize;
            let ace_type = (*header).ace_type;

            let is_deny = ace_type == 1; // ACCESS_DENIED_ACE_TYPE
            let mut matches = false;
            if is_deny {
                // 拒绝 ACE 的 SID 从第 8 字节开始（header 4 + mask 4）。
                let sid_ptr = acl.add(cursor + 8) as *const c_void;
                if let Ok(text) = sid_to_string(sid_ptr) {
                    matches = text.to_ascii_uppercase() == target;
                }
            }
            if is_deny && matches {
                removed += 1;
            } else {
                buffer.extend_from_slice(std::slice::from_raw_parts(acl.add(cursor), ace_size));
            }
            cursor += ace_size;
        }

        // 改头部：AclSize 在字节 2-3，AceCount 在字节 4-5（新 ACL 只会更小，容量不变）。
        let total = buffer.len();
        buffer[2] = (total & 0xFF) as u8;
        buffer[3] = ((total >> 8) & 0xFF) as u8;
        let kept = (ace_count - removed) as u16;
        buffer[4] = (kept & 0xFF) as u8;
        buffer[5] = ((kept >> 8) & 0xFF) as u8;

        // SACL 为 NULL 时 SetNamedSecurityInfoW 会报 1299，随行 medium 标签兜底。
        let mut sacl = parts.sacl;
        let mut extra_free: Vec<*mut c_void> = Vec::new();
        if sacl.is_null() {
            let medium = sddl_to_descriptor("S:(ML;;NW;;;ME)")?;
            extra_free.push(medium);
            sacl = split_descriptor(medium)?.sacl;
        }
        let mut bits = DACL_SECURITY_INFORMATION;
        if !sacl.is_null() { bits |= LABEL_SECURITY_INFORMATION; }
        let result = set_named_security_info(path, bits, ptr::null(), ptr::null(), buffer.as_ptr() as *const c_void, sacl);
        parts.drop();
        for block in extra_free {
            LocalFree(block);
        }
        result?;
        Ok(removed)
    }
}

// ── 进程 ────────────────────────────────────────────────────────────────

pub struct ProcEntry {
    pub pid: u32,
    pub ppid: u32,
    pub exe: String,
}

pub fn process_snapshot() -> c_result<Vec<ProcEntry>> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(last_error("进程快照失败"));
        }
        let mut entry = PROCESSENTRY32W {
            dw_size: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            cnt_usage: 0, th32_process_id: 0, th32_default_heap_id: 0, th32_module_id: 0,
            cnt_threads: 0, th32_parent_process_id: 0, pc_pri_class_base: 0, dw_flags: 0,
            sz_exe_file: [0; 260],
        };
        let mut entries = Vec::new();
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                entries.push(ProcEntry {
                    pid: entry.th32_process_id,
                    ppid: entry.th32_parent_process_id,
                    exe: from_wide(&entry.sz_exe_file),
                });
                if Process32NextW(snapshot, &mut entry) == 0 { break; }
            }
        }
        CloseHandle(snapshot);
        Ok(entries)
    }
}

/// 杀进程树：从快照里按 ppid 找出全部后代（快照瞬间的一致视图），叶子先杀。
/// 拒绝杀 0 / 4（System）和自己。返回实际终止的 pid 列表。
pub fn kill_tree(root_pid: u32, dry_run: bool) -> c_result<Vec<u32>> {
    if root_pid == 0 || root_pid == 4 {
        return Err(format!("拒绝杀系统进程 {}", root_pid));
    }
    let me = unsafe { GetCurrentProcessId() };
    if root_pid == me {
        return Err("拒绝杀 doctor-sys 自己".into());
    }
    let snapshot = process_snapshot()?;
    let mut tree = vec![root_pid];
    let mut changed = true;
    while changed {
        changed = false;
        for entry in &snapshot {
            if tree.contains(&entry.ppid) && !tree.contains(&entry.pid) {
                tree.push(entry.pid);
                changed = true;
            }
        }
    }
    // 叶子（后加入的是更深的后代）先杀，父进程来不及 respawn 子进程。
    let mut killed = Vec::new();
    for &pid in tree.iter().rev() {
        if pid == 0 || pid == 4 || pid == me { continue; }
        if dry_run {
            killed.push(pid);
            continue;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if handle == 0 {
                // 进程可能已退出：杀树时这不算失败。
                continue;
            }
            let ok = TerminateProcess(handle, 1) != 0;
            CloseHandle(handle);
            if ok { killed.push(pid); }
        }
    }
    Ok(killed)
}

// ── 端口 ────────────────────────────────────────────────────────────────

/// 谁在监听这个 TCP 端口（仅 127.0.0.1 / 0.0.0.0 的 IPv4 监听者）。
pub fn tcp_listener_pid(port: u16) -> c_result<Option<u32>> {
    unsafe {
        let mut size: u32 = 0;
        GetExtendedTcpTable(ptr::null_mut(), &mut size, 0, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0);
        if size == 0 {
            return Ok(None);
        }
        let mut buffer = vec![0u8; size as usize];
        let result = GetExtendedTcpTable(
            buffer.as_mut_ptr() as *mut c_void, &mut size, 0, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0,
        );
        if result == ERROR_INSUFFICIENT_BUFFER {
            return Err("TCP 表大小又变了，重试一次".into());
        }
        if result != ERROR_SUCCESS {
            return Err(format!("读 TCP 表失败（Win32 错误 {}）", result));
        }
        let table = buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
        let count = (*table).dw_num_entries as usize;
        for index in 0..count {
            // table 只声明了 1 个元素，越界访问必须走指针，不能下标（会做边界检查）。
            let row = &*((*table).table.as_ptr().add(index));
            // dw_local_port 是网络字节序的低 16 位。
            if row.dw_state == MIB_TCP_STATE_LISTEN && u16::from_be(row.dw_local_port as u16) == port {
                return Ok(Some(row.dw_owning_pid));
            }
        }
        Ok(None)
    }
}

// ── 外壳刷新 ────────────────────────────────────────────────────────────

/// 通知 Explorer 重取图标。给 path 只刷那个目录；不给则全局关联刷新（图标缓存全量重建）。
pub fn shell_refresh(path: Option<&str>) {
    match path {
        Some(path) => {
            let wide = to_wide(path);
            unsafe {
                SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATHW, wide.as_ptr() as *const c_void, ptr::null());
            }
        }
        None => unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, ptr::null(), ptr::null());
        },
    }
}

// ── 原生气泡通知（Shell_NotifyIconW NIF_INFO）───────────────────────────

unsafe extern "system" fn balloon_wndproc(hwnd: isize, msg: u32, w_param: usize, l_param: isize) -> isize {
    const WM_APP_CB: u32 = WM_APP + 1;
    match msg {
        WM_APP_CB => match l_param {
            NIN_BALLOONHIDE | NIN_BALLOONTIMEOUT | NIN_BALLOONUSERCLICK => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, msg, w_param, l_param),
        },
        WM_TIMER => {
            // w_param 是定时器 id：1 = 兜底超时
            if w_param == 1 { PostQuitMessage(0); }
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, w_param, l_param),
    }
}

/// 弹一个原生气泡（Windows 通知）。DSH 死透时唯一可用的通知通道。
/// 返回 true = 气泡送出去了（用户点掉或超时结束）。
pub fn balloon(title: &str, body: &str, max_wait_ms: u32) -> bool {
    const CLASS_NAME: &str = "dsh-doctor-sys-notify";
    unsafe {
        let instance = GetModuleHandleW(ptr::null());
        let class_name = to_wide(CLASS_NAME);
        let wc = WNDCLASSEXW {
            cb_size: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: 0,
            lpfn_wnd_proc: Some(balloon_wndproc),
            cb_clsextra: 0,
            cb_wndextra: 0,
            h_instance: instance,
            h_icon: 0,
            h_cursor: 0,
            h_brush_background: 0,
            lpsz_menu_name: ptr::null(),
            lpsz_class_name: class_name.as_ptr(),
            h_icon_sm: 0,
        };
        if RegisterClassExW(&wc) == 0 {
            eprintln!("doctor-sys notify: RegisterClassExW failed ({})", last_error("注册窗口类"));
            return false;
        }
        let window_name = to_wide("dsh-doctor");
        let hwnd = CreateWindowExW(
            0, class_name.as_ptr(), window_name.as_ptr(),
            0, // WS_OVERLAPPED，不显示
            0, 0, 0, 0, 0, 0, instance, ptr::null_mut(),
        );
        if hwnd == 0 {
            eprintln!("doctor-sys notify: CreateWindowExW failed ({})", last_error("建窗口"));
            UnregisterClassW(class_name.as_ptr(), instance);
            return false;
        }

        let mut data: NOTIFYICONDATAW = std::mem::zeroed();
        data.cb_size = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        data.hwnd = hwnd;
        data.u_id = 1;
        // Win11 上不带图标的 NIF_INFO 会被 NIM_ADD 拒掉，挂标准应用图标最稳。
        data.u_flags = NIF_MESSAGE | NIF_INFO | NIF_ICON;
        data.h_icon = LoadIconW(0, IDI_APPLICATION);
        data.u_callback_message = WM_APP + 1;
        data.dw_info_flags = NIIF_INFO | NIIF_RESPECT_QUIET_TIME;
        write_u16_array(&mut data.sz_info_title, title);
        write_u16_array(&mut data.sz_info, body);

        let added = Shell_NotifyIconW(NIM_ADD, &mut data) != 0;
        if !added {
            eprintln!("doctor-sys notify: NIM_ADD failed ({})", last_error("加托盘图标"));
        }
        if added {
            // 兜底定时器：气泡回调丢了也不至于挂死。
            SetTimer(hwnd, 1, max_wait_ms, ptr::null_mut());
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            KillTimer(hwnd, 1);
            let mut deletion = std::mem::zeroed::<NOTIFYICONDATAW>();
            deletion.cb_size = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            deletion.hwnd = hwnd;
            deletion.u_id = 1;
            Shell_NotifyIconW(NIM_DELETE, &mut deletion);
        }
        DestroyWindow(hwnd);
        UnregisterClassW(class_name.as_ptr(), instance);
        added
    }
}

/// 帮助把进程表转成 JSON 数组（main.rs 用）。
pub fn processes_to_json() -> c_result<Json> {
    let entries = process_snapshot()?;
    let items = entries.into_iter()
        .map(|entry| Json::obj()
            .set("pid", Json::num(entry.pid as i64))
            .set("ppid", Json::num(entry.ppid as i64))
            .set("exe", Json::str(entry.exe)))
        .collect();
    Ok(Json::Arr(items))
}
