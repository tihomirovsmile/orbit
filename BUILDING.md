# Сборка Orbit

Для запуска исходников нужны Node.js 24 и npm:

```sh
npm ci
npm run check
npm run launch
```

`npm run launch:app` открывает отдельное окно, `npm run launch:web` включает доступ в локальной сети. Остановите процесс в терминале после использования. Исходная версия хранит данные в `storage` рядом с проектом. Не публикуйте эту папку, `.env` и ключи.

Для сборки Windows x64 установите Rust stable (GNU toolchain) и Inno Setup 7. Затем в PowerShell:

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal
powershell -ExecutionPolicy Bypass -File scripts/build-desktop.ps1
powershell -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

Скрипт использует текущую Node.js 24 x64, собирает сервер, интерфейс, Rust-приложение и установщик. В `releases` появятся установщик, чистая папка исходников для GitHub, общий архив и SHA-256. Компиляторы и личные данные в поставку не включаются.

Для проверки без открытия браузера у собранного `Orbit.exe` есть `--check`: он запускает сервер, проверяет готовность и корректно завершает его. Для изоляции проверки задайте `ORBIT_DATA_DIR` и свободный `ORBIT_PORT`. `--settings` открывает выбор режима даже при сохранённом автоматическом запуске.

Финальная поставка не подписана сертификатом издателя. Разработка и поддержка завершены.
