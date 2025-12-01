import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate, MessagingDelegate {

    var window: UIWindow?

    // MARK: - App launch

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {

        // ✅ Initialise Firebase
        FirebaseApp.configure()

        // ✅ Set delegates for notifications
        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self

        return true
    }

    // MARK: - Push registration (APNs -> Capacitor + Firebase)

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        // ✅ Forward APNs token to Firebase Messaging
        Messaging.messaging().apnsToken = deviceToken

        // ✅ Forward token to Capacitor PushNotifications plugin
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // ✅ Let Capacitor know registration failed
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }

    // MARK: - (Optional) Observe FCM token changes

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        print("✅ [FirebaseMessaging] FCM registration token: \(fcmToken ?? "nil")")
        // You don't *have* to do anything here because your JS side
        // will use @capacitor/push-notifications' registration event.
    }

    // MARK: - Existing lifecycle methods (kept as-is)

    func applicationWillResignActive(_ application: UIApplication) {
        // pause tasks if needed
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // handle background if needed
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // undo changes from background if needed
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // restart tasks if needed
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // handle termination if needed
    }

    // MARK: - URL / Universal Link handling (Capacitor)

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        // Keep this so Capacitor can handle URLs
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(
        _ application: UIApplication,
        continue userActivity: NSUserActivity,
        restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
    ) -> Bool {
        // Keep this so Capacitor can handle Universal Links
        return ApplicationDelegateProxy.shared.application(
            application,
            continue: userActivity,
            restorationHandler: restorationHandler
        )
    }
}
