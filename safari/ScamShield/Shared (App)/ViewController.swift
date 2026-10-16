// The container app's only screen: a local page that explains what the
// extension does and how to turn it on. On macOS it also shows whether the
// extension is on and opens Safari's extension settings.

import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

let extensionBundleIdentifier = "com.aliefauzan.scamshield.Extension"

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self
        self.webView.configuration.userContentController.add(self, name: "controller")
        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)

#if os(macOS)
        // Coming back from Safari Settings: show the new state.
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshState()
        }
#endif
    }

    // Only the bundled page may load; links never open inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if os(iOS)
        webView.evaluateJavaScript("show('ios')")
#elseif os(macOS)
        webView.evaluateJavaScript("show('mac', 'unknown', \(legacyNames))")
        refreshState()
#endif
    }

#if os(macOS)
    // macOS 12 still calls Safari Settings "Preferences".
    private var legacyNames: Bool {
        if #available(macOS 13, *) { return false }
        return true
    }

    private func refreshState() {
        let legacy = legacyNames
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] (state, error) in
            let value = (error == nil && state != nil) ? (state!.isEnabled ? "on" : "off") : "error"
            NSLog("ScamShield: extension state \(value)")
            DispatchQueue.main.async {
                self?.webView.evaluateJavaScript("show('mac', '\(value)', \(legacy))")
            }
        }
    }

#endif

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
#if os(macOS)
        guard (message.body as? String) == "open-preferences" else { return }
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            if let error = error {
                NSLog("ScamShield: could not open Safari settings: \(error.localizedDescription)")
            }
        }
#endif
    }

}
