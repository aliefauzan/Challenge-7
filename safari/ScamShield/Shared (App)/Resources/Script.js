// Called from ViewController.swift once the page has loaded.
//   show("ios")                      Settings steps
//   show("mac", state)               state: "on" | "off" | "unknown" | "error"
//   show("mac", state, legacyNames)  legacyNames: macOS 12 calls it "Preferences"
function show(platform, state = "unknown", legacyNames = false) {
    document.body.classList.add(`platform-${platform}`);
    for (const s of ["on", "off", "unknown", "error"]) document.body.classList.toggle(`state-${s}`, s === state);
    if (legacyNames) document.getElementById("open-settings").textContent = "Open Safari Extensions Preferences";
}

document.getElementById("open-settings").addEventListener("click", () => {
    webkit.messageHandlers.controller.postMessage("open-preferences");
});
