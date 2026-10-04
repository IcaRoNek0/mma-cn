use std::env;

fn main() {
    // Library tests and benches link Tauri without the desktop binary. On Windows,
    // they need the Common-Controls v6 activation context too.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        let manifest = env::current_dir()
            .unwrap()
            .join("windows-test-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        // Embed the same manifest once through the linker, including library tests.
        // Tauri still supplies the desktop icon and version resources.
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("Tauri build failed");
        return;
    }
    tauri_build::build();
}
