#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    ffi::c_void,
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
type Handle = *mut c_void;
#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
#[repr(C)]
struct DrawItem {
    kind: u32,
    id: u32,
    item: u32,
    action: u32,
    state: u32,
    window: Handle,
    dc: Handle,
    rect: Rect,
    data: usize,
}
#[repr(C)]
struct WndClass {
    style: u32,
    proc: Option<unsafe extern "system" fn(Handle, u32, usize, isize) -> isize>,
    cls: i32,
    wnd: i32,
    instance: Handle,
    icon: Handle,
    cursor: Handle,
    brush: Handle,
    menu: *const u16,
    name: *const u16,
}
#[repr(C)]
#[derive(Default)]
struct Point {
    x: i32,
    y: i32,
}
#[repr(C)]
struct Msg {
    hwnd: Handle,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    pt: Point,
    private: u32,
}
#[link(name = "user32")]
extern "system" {
    fn RegisterClassW(c: *const WndClass) -> u16;
    fn CreateWindowExW(
        ex: u32,
        class: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        parent: Handle,
        menu: Handle,
        instance: Handle,
        param: Handle,
    ) -> Handle;
    fn DefWindowProcW(h: Handle, m: u32, w: usize, l: isize) -> isize;
    fn ShowWindow(h: Handle, n: i32) -> i32;
    fn GetMessageW(m: *mut Msg, h: Handle, min: u32, max: u32) -> i32;
    fn TranslateMessage(m: *const Msg) -> i32;
    fn DispatchMessageW(m: *const Msg) -> isize;
    fn SendMessageW(h: Handle, m: u32, w: usize, l: isize) -> isize;
    fn SetWindowTextW(h: Handle, text: *const u16) -> i32;
    fn PostQuitMessage(code: i32);
    fn DestroyWindow(h: Handle) -> i32;
    fn LoadCursorW(h: Handle, name: *const u16) -> Handle;
    fn LoadImageW(h: Handle, name: *const u16, t: u32, x: i32, y: i32, flags: u32) -> Handle;
    fn SetTimer(h: Handle, id: usize, ms: u32, callback: Handle) -> usize;
    fn EnableWindow(h: Handle, enabled: i32) -> i32;
    fn GetWindowTextW(h: Handle, text: *mut u16, max: i32) -> i32;
    fn DrawTextW(dc: Handle, text: *const u16, count: i32, rect: *mut Rect, flags: u32) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(name: *const u16) -> Handle;
    fn CreateMutexW(attr: Handle, owner: i32, name: *const u16) -> Handle;
    fn GetLastError() -> u32;
    fn CloseHandle(h: Handle) -> i32;
    fn LoadLibraryW(name: *const u16) -> Handle;
    fn GetProcAddress(h: Handle, name: *const u8) -> *mut c_void;
}
#[link(name = "gdi32")]
extern "system" {
    fn CreateSolidBrush(color: u32) -> Handle;
    fn SetTextColor(dc: Handle, color: u32) -> u32;
    fn SetBkColor(dc: Handle, color: u32) -> u32;
    fn GetStockObject(i: i32) -> Handle;
    fn SelectObject(dc: Handle, obj: Handle) -> Handle;
    fn SetDCBrushColor(dc: Handle, color: u32) -> u32;
    fn SetDCPenColor(dc: Handle, color: u32) -> u32;
    fn RoundRect(dc: Handle, l: i32, t: i32, r: i32, b: i32, w: i32, h: i32) -> i32;
    fn SetBkMode(dc: Handle, mode: i32) -> i32;
    fn CreateFontW(
        height: i32,
        width: i32,
        escapement: i32,
        orientation: i32,
        weight: i32,
        italic: u32,
        underline: u32,
        strikeout: u32,
        charset: u32,
        output: u32,
        clip: u32,
        quality: u32,
        pitch: u32,
        face: *const u16,
    ) -> Handle;
}
#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        h: Handle,
        op: *const u16,
        file: *const u16,
        args: *const u16,
        dir: *const u16,
        show: i32,
    ) -> isize;
}
unsafe fn set_window_theme(h: Handle, app: *const u16, id: *const u16) -> i32 {
    let lib = LoadLibraryW(wide("uxtheme.dll").as_ptr());
    let f = GetProcAddress(lib, b"SetWindowTheme\0".as_ptr());
    if f.is_null() {
        return 0;
    }
    let call: unsafe extern "system" fn(Handle, *const u16, *const u16) -> i32 =
        std::mem::transmute(f);
    call(h, app, id)
}
unsafe fn dwm_set_window_attribute(h: Handle, a: u32, value: *const i32, size: u32) -> i32 {
    let lib = LoadLibraryW(wide("dwmapi.dll").as_ptr());
    let f = GetProcAddress(lib, b"DwmSetWindowAttribute\0".as_ptr());
    if f.is_null() {
        return 0;
    }
    let call: unsafe extern "system" fn(Handle, u32, *const i32, u32) -> i32 =
        std::mem::transmute(f);
    call(h, a, value, size)
}
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
fn root() -> PathBuf {
    std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}
fn data() -> PathBuf {
    std::env::var_os("ORBIT_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap()).join("Orbit"))
}
#[derive(Clone, Debug, PartialEq)]
struct Prefs {
    mode: String,
    ask: bool,
}
impl Prefs {
    fn load() -> Self {
        let text = fs::read_to_string(data().join("launcher.ini")).unwrap_or_default();
        Self::parse(&text)
    }
    fn parse(text: &str) -> Self {
        let mut p = Self {
            mode: "app".into(),
            ask: true,
        };
        for line in text.lines() {
            if let Some(m) = line.strip_prefix("mode=") {
                if ["app", "local", "lan"].contains(&m) {
                    p.mode = m.into();
                }
            }
            if line == "ask=false" {
                p.ask = false;
            }
        }
        p
    }
    fn save(&self) -> Result<(), String> {
        fs::create_dir_all(data()).map_err(|e| e.to_string())?;
        let file = data().join("launcher.ini");
        fs::write(
            file.with_extension("tmp"),
            format!("mode={}\nask={}\n", self.mode, self.ask),
        )
        .map_err(|e| e.to_string())?;
        fs::rename(file.with_extension("tmp"), file).map_err(|e| e.to_string())
    }
}
struct Server {
    child: Child,
}
impl Server {
    fn start(mode: &str) -> Result<Self, String> {
        let home = root().join("app");
        let runtime = root().join("runtime/node.exe");
        if !runtime.is_file() || !home.join("server/apps/server/src/index.js").is_file() {
            return Err("Не найдены файлы Orbit. Переустановите приложение.".into());
        }
        fs::create_dir_all(data()).map_err(|e| e.to_string())?;
        let port = port();
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Err(format!(
                "Порт {port} занят. Закройте другой экземпляр Orbit или программу на этом порту."
            ));
        }
        let log = fs::File::create(data().join("launcher.log")).map_err(|e| e.to_string())?;
        let mut command = Command::new(runtime);
        command
            .arg(home.join("server/apps/server/src/index.js"))
            .current_dir(home)
            .env("DATA_DIR", data().join("data"))
            .env(
                "HOST",
                if mode == "lan" {
                    "0.0.0.0"
                } else {
                    "127.0.0.1"
                },
            )
            .env("PORT", port.to_string())
            .env("NODE_ENV", "desktop")
            .env("PUBLIC_ORIGIN", format!("http://localhost:{port}"))
            .env("SECURE_COOKIE", "false")
            .env("RUNTIME_CONFIG_FILE", data().join("runtime.json"))
            .env("ORBIT_DESKTOP_CONFIG_FILE", data().join("launcher.ini"))
            .stdin(Stdio::piped())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log)
            .creation_flags(0x08000000);
        let child = command
            .spawn()
            .map_err(|e| format!("Не удалось запустить Orbit: {e}"))?;
        let mut server = Self { child };
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(30) {
            if server
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                return Err("Orbit не запустился. Подробности сохранены в launcher.log рядом с данными приложения.".into());
            }
            if ready(port) {
                return Ok(server);
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        Err("Orbit не успел запуститься. Проверьте launcher.log и повторите запуск.".into())
    }
    fn stop(&mut self) {
        if let Some(mut input) = self.child.stdin.take() {
            let _ = input.write_all(b"shutdown\n");
        }
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(10) {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}
fn local_address() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("192.0.2.1:80")?;
            socket.local_addr()
        })
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|_| "IP-компьютера".into())
}
fn port() -> u16 {
    std::env::var("ORBIT_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|p| *p > 0)
        .unwrap_or(3000)
}
fn ready(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}").parse().unwrap();
    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
        let _ = stream.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n");
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        return response.contains("200 OK") && response.contains("3.0.0");
    }
    false
}
fn open_url(url: &str) {
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            wide("open").as_ptr(),
            wide(url).as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        );
    }
}
fn open(mode: &str) {
    let url = format!("http://localhost:{}", port());
    if mode == "app" {
        for base in ["PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(base) {
                for relative in [
                    "Microsoft/Edge/Application/msedge.exe",
                    "Google/Chrome/Application/chrome.exe",
                ] {
                    let browser = PathBuf::from(&base).join(relative);
                    if browser.is_file()
                        && Command::new(browser)
                            .arg(format!("--app={url}"))
                            .arg(format!(
                                "--user-data-dir={}",
                                data().join("browser").display()
                            ))
                            .arg("--no-first-run")
                            .arg("--no-default-browser-check")
                            .creation_flags(0x08000000)
                            .spawn()
                            .is_ok()
                    {
                        return;
                    }
                }
            }
        }
    }
    open_url(&url);
}
struct UI {
    mode: Handle,
    ask: Handle,
    status: Handle,
    start: Handle,
    server: Option<Server>,
    current: String,
}
unsafe fn state<'a>(h: Handle) -> &'a mut UI {
    &mut *(SendMessageW(h, 0x0400 + 1, 0, 0) as *mut UI)
}
// Window state lives in a Box for the full message loop and is accessed on its UI thread.
static mut UI_PTR: *mut UI = std::ptr::null_mut();
static mut UI_BRUSH: Handle = std::ptr::null_mut();
static mut UI_FONT: Handle = std::ptr::null_mut();
unsafe extern "system" fn window_proc(h: Handle, m: u32, w: usize, l: isize) -> isize {
    if m == 0x0400 + 1 {
        return UI_PTR as isize;
    }
    if m == 0x0010 {
        if !UI_PTR.is_null() {
            state(h).server.take();
        }
        DestroyWindow(h);
        return 0;
    }
    if m == 0x0002 {
        PostQuitMessage(0);
        return 0;
    }
    if UI_PTR.is_null() {
        return DefWindowProcW(h, m, w, l);
    }
    if m == 0x0138 || m == 0x0135 || m == 0x0136 {
        SetTextColor(w as Handle, 0x00eee8e5);
        SetBkColor(w as Handle, 0x001e1916);
        return UI_BRUSH as isize;
    }
    if m == 0x002b && l != 0 {
        let item = &mut *(l as *mut DrawItem);
        let background = if item.id == 101 {
            if item.state & 1 != 0 {
                0x00b18456
            } else {
                0x00edbb83
            }
        } else if item.state & 1 != 0 {
            0x00503e30
        } else {
            0x00382e27
        };
        let old_brush = SelectObject(item.dc, GetStockObject(18));
        let old_pen = SelectObject(item.dc, GetStockObject(19));
        SetDCBrushColor(item.dc, background);
        SetDCPenColor(
            item.dc,
            if item.state & 0x10 != 0 {
                0x00ffe3bf
            } else {
                background
            },
        );
        RoundRect(
            item.dc,
            item.rect.left,
            item.rect.top,
            item.rect.right,
            item.rect.bottom,
            14,
            14,
        );
        SetBkMode(item.dc, 1);
        let old_font = SelectObject(item.dc, UI_FONT);
        SetTextColor(
            item.dc,
            if item.id == 101 {
                0x00201914
            } else {
                0x00f4ebe5
            },
        );
        let mut text = [0u16; 128];
        let len = GetWindowTextW(item.window, text.as_mut_ptr(), 128);
        DrawTextW(
            item.dc,
            text.as_ptr(),
            len,
            &mut item.rect,
            0x0001 | 0x0004 | 0x0020,
        );
        SelectObject(item.dc, old_font);
        SelectObject(item.dc, old_pen);
        SelectObject(item.dc, old_brush);
        return 1;
    }
    if m == 0x0113 {
        let u = state(h);
        if let Some(server) = &mut u.server {
            if matches!(server.child.try_wait(), Ok(Some(_))) {
                u.server.take();
                EnableWindow(u.mode, 1);
                SetWindowTextW(u.start, wide("Запустить Orbit").as_ptr());
                SetWindowTextW(
                    u.status,
                    wide("Orbit остановлен. Проверьте журнал приложения перед повторным запуском.")
                        .as_ptr(),
                );
            }
        }
        return 0;
    }
    if m == 0x0111 {
        let u = state(h);
        match w & 0xffff {
            101 => {
                let n = SendMessageW(u.mode, 0x0147, 0, 0);
                let p = Prefs {
                    mode: ["app", "local", "lan"]
                        .get(n as usize)
                        .unwrap_or(&"app")
                        .to_string(),
                    ask: SendMessageW(u.ask, 0x00f0, 0, 0) == 1,
                };
                if let Err(e) = p.save() {
                    SetWindowTextW(u.status, wide(&e).as_ptr());
                    return 0;
                }
                if u.server.is_some() {
                    open(&u.current);
                } else {
                    SetWindowTextW(u.status, wide("Запускаем Orbit…").as_ptr());
                    match Server::start(&p.mode) {
                        Ok(server) => {
                            u.current = p.mode.clone();
                            u.server = Some(server);
                            EnableWindow(u.mode, 0);
                            SetWindowTextW(u.start, wide("Открыть Orbit").as_ptr());
                            let text = if p.mode == "lan" {
                                format!("Orbit запущен. Адрес для устройств в вашей сети:\nhttp://{}:{}\nДля остановки закройте это окно.",local_address(),port())
                            } else {
                                "Orbit запущен. Для остановки закройте это окно.\nНастройки запуска можно изменить здесь или в настройках Orbit.".into()
                            };
                            SetWindowTextW(u.status, wide(&text).as_ptr());
                            open(&p.mode);
                        }
                        Err(e) => {
                            SetWindowTextW(u.status, wide(&e).as_ptr());
                        }
                    }
                }
            }
            102 => {
                u.server.take();
                EnableWindow(u.mode, 1);
                SetWindowTextW(u.start, wide("Запустить Orbit").as_ptr());
                SetWindowTextW(
                    u.status,
                    wide("Orbit остановлен. Выберите режим и запустите снова.").as_ptr(),
                );
            }
            103 => {
                let n = SendMessageW(u.mode, 0x0147, 0, 0);
                let p = Prefs {
                    mode: ["app", "local", "lan"]
                        .get(n as usize)
                        .unwrap_or(&"app")
                        .to_string(),
                    ask: SendMessageW(u.ask, 0x00f0, 0, 0) == 1,
                };
                let text = match p.save() {
                    Ok(()) => {
                        "Настройки сохранены. Новый режим применяется при следующем запуске.".into()
                    }
                    Err(e) => e,
                };
                SetWindowTextW(u.status, wide(&text).as_ptr());
            }
            104 => open_url("https://github.com/tihomirovsmile/orbit"),
            _ => {}
        }
        return 0;
    }
    DefWindowProcW(h, m, w, l)
}
unsafe fn control(
    parent: Handle,
    class: &str,
    text: &str,
    style: u32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    id: usize,
) -> Handle {
    let style = if class == "BUTTON" && (101..=104).contains(&id) {
        (style & !15) | 11
    } else {
        style
    };
    let c = CreateWindowExW(
        0,
        wide(class).as_ptr(),
        wide(text).as_ptr(),
        0x50000000 | style,
        x,
        y,
        w,
        h,
        parent,
        id as Handle,
        GetModuleHandleW(std::ptr::null()),
        std::ptr::null_mut(),
    );
    SendMessageW(c, 0x0030, UI_FONT as usize, 1);
    set_window_theme(c, wide("DarkMode_Explorer").as_ptr(), std::ptr::null());
    c
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--check") {
        let mode = args
            .windows(2)
            .find(|v| v[0] == "--mode")
            .map(|v| v[1].as_str())
            .unwrap_or("local");
        if !["app", "local", "lan"].contains(&mode) {
            std::process::exit(2);
        }
        let result = Server::start(mode);
        let ok = result.is_ok();
        drop(result);
        std::process::exit(if ok { 0 } else { 1 });
    }
    unsafe {
        let mutex_name = format!("Local\\Orbit-{:x}", {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            data().hash(&mut h);
            h.finish()
        });
        let mutex = CreateMutexW(std::ptr::null_mut(), 0, wide(&mutex_name).as_ptr());
        if GetLastError() == 183 {
            open_url(&format!("http://localhost:{}", port()));
            if !mutex.is_null() {
                CloseHandle(mutex);
            }
            return;
        }
        let instance = GetModuleHandleW(std::ptr::null());
        let brush = CreateSolidBrush(0x001e1916);
        UI_BRUSH = brush;
        UI_FONT = CreateFontW(
            -15,
            0,
            0,
            0,
            400,
            0,
            0,
            0,
            1,
            0,
            0,
            5,
            0,
            wide("Segoe UI").as_ptr(),
        );
        let class = wide("OrbitDesktopWindow");
        let icon = LoadImageW(
            std::ptr::null_mut(),
            wide(&root().join("Orbit.ico").to_string_lossy()).as_ptr(),
            1,
            0,
            0,
            0x0010 | 0x0040,
        );
        let wc = WndClass {
            style: 3,
            proc: Some(window_proc),
            cls: 0,
            wnd: 0,
            instance,
            icon,
            cursor: LoadCursorW(std::ptr::null_mut(), 32512usize as *const u16),
            brush,
            menu: std::ptr::null(),
            name: class.as_ptr(),
        };
        RegisterClassW(&wc);
        let window = CreateWindowExW(
            0,
            class.as_ptr(),
            wide("Orbit · Final").as_ptr(),
            0x00ca0000,
            0x80000000u32 as i32,
            0x80000000u32 as i32,
            600,
            480,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null_mut(),
        );
        if window.is_null() {
            return;
        }
        dwm_set_window_attribute(window, 20, &1, 4);
        control(window, "STATIC", "ORBIT", 0, 28, 24, 530, 32, 0);
        control(window,"STATIC","Экспериментальная социальная сеть · Финальная версия\nРазработка завершена. Обновлений и поддержки не будет.",0,28,62,530,46,0);
        control(window, "STATIC", "Режим запуска", 0, 28, 122, 520, 22, 0);
        let mode = control(
            window,
            "COMBOBOX",
            "",
            3 | 0x00200000 | 0x00010000,
            28,
            148,
            530,
            170,
            110,
        );
        for label in [
            "Приложение — отдельное окно Edge / Chrome",
            "Локально — открыть в браузере",
            "Сеть — доступ с устройств в вашей локальной сети",
        ] {
            SendMessageW(mode, 0x0143, 0, wide(label).as_ptr() as isize);
        }
        let p = Prefs::load();
        SendMessageW(
            mode,
            0x014e,
            ["app", "local", "lan"]
                .iter()
                .position(|m| *m == p.mode)
                .unwrap_or(0),
            0,
        );
        let ask = control(
            window,
            "BUTTON",
            "Спрашивать режим при каждом запуске",
            3 | 0x00010000,
            28,
            188,
            530,
            28,
            111,
        );
        SendMessageW(ask, 0x00f1, usize::from(p.ask), 0);
        let start = control(
            window,
            "BUTTON",
            "Запустить Orbit",
            0x00010001,
            28,
            232,
            168,
            36,
            101,
        );
        control(
            window,
            "BUTTON",
            "Остановить",
            0x00010000,
            206,
            232,
            165,
            36,
            102,
        );
        control(
            window,
            "BUTTON",
            "Сохранить",
            0x00010000,
            381,
            232,
            177,
            36,
            103,
        );
        let status=control(window,"STATIC","Выберите режим. Данные сохраняются между запусками.\nОкно приложения использует установленный Edge или Chrome.",0,28,286,530,72,0);
        control(
            window,
            "BUTTON",
            "GitHub · исходники и лицензия MIT",
            0x00010000,
            28,
            374,
            530,
            34,
            104,
        );
        let mut ui = Box::new(UI {
            mode,
            ask,
            status,
            start,
            server: None,
            current: p.mode.clone(),
        });
        UI_PTR = &mut *ui;
        SetTimer(window, 1, 2000, std::ptr::null_mut());
        ShowWindow(window, 1);
        ShowWindow(window, 5);
        if !p.ask && !args.iter().any(|a| a == "--settings") {
            SendMessageW(window, 0x0111, 101, 0);
        }
        let mut msg: Msg = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        UI_PTR = std::ptr::null_mut();
        drop(ui);
        if !mutex.is_null() {
            CloseHandle(mutex);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preferences_validate_modes_and_defaults() {
        assert_eq!(
            Prefs::parse("mode=other\nask=false\n"),
            Prefs {
                mode: "app".into(),
                ask: false
            }
        );
        assert_eq!(Prefs::parse("mode=lan\r\nask=true\r\n").mode, "lan");
    }
}
