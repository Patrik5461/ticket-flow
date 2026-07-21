import UIKit
import WebKit
import Capacitor

/// App shell colour (zinc-950) — must match `backgroundColor` in
/// capacitor.config.ts and `--bg` in src/theme.css.
let ticketioBackground = UIColor(red: 0x09 / 255.0, green: 0x09 / 255.0, blue: 0x0b / 255.0, alpha: 1)

/**
 Bridge view controller with a forced opaque dark shell.

 Capacitor sets `view = webView`, so anything the HTML does not paint (the
 safe-area strips under the Dynamic Island / home indicator, and any rubber-band
 overscroll) shows the NATIVE webview background. If the config colour is not
 picked up it falls back to `UIColor.systemBackground`, which is WHITE while the
 device is in light appearance — that is the white bar. Setting it here makes it
 independent of config parsing and of the device's light/dark mode.

 Wired up in Base.lproj/Main.storyboard (customClass="MainViewController").
 */
class MainViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        applyDarkShell()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Re-assert: the barcode scanner makes the webview transparent while the
        // native camera runs behind it and must not leave it that way.
        applyDarkShell()
    }

    private func applyDarkShell() {
        view.backgroundColor = ticketioBackground
        // Ignore the system light/dark appearance entirely — the app is dark-only.
        overrideUserInterfaceStyle = .dark
        guard let webView = self.webView else { return }
        webView.isOpaque = true
        webView.backgroundColor = ticketioBackground
        webView.scrollView.backgroundColor = ticketioBackground
        // Edge-to-edge: CSS env(safe-area-inset-*) does the insetting, not UIKit.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
    }

    /// Light text in the status bar from the very first frame (the StatusBar
    /// plugin re-asserts this later, but only once the webview has booted).
    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Dark behind everything, including during rotation/launch transitions.
        window?.backgroundColor = ticketioBackground
        window?.overrideUserInterfaceStyle = .dark
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
