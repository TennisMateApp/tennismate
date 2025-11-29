// PluginViewController.swift
import UIKit
import Capacitor

class PluginViewController: CAPBridgeViewController {
    override open func viewDidLoad() {
        super.viewDidLoad()
        DispatchQueue.main.async {
            self.setupWebViewPadding()
        }
    }

    override open func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        DispatchQueue.main.async {
            self.setupWebViewPadding()
        }
    }

    override open func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        setupWebViewPadding()
    }

    private func setupWebViewPadding() {
        guard let webView = self.webView else { return }

        var top: CGFloat = 0
        var bottom: CGFloat = 0
        var left: CGFloat = 0
        var right: CGFloat = 0

        if #available(iOS 13.0, *) {
            let window = view.window ?? UIApplication.shared.windows.first { $0.isKeyWindow }
            top = window?.safeAreaInsets.top ?? 0
            bottom = window?.safeAreaInsets.bottom ?? 0
            left = window?.safeAreaInsets.left ?? 0
            right = window?.safeAreaInsets.right ?? 0
        } else {
            top = UIApplication.shared.statusBarFrame.height
        }

        webView.frame.origin = CGPoint(x: left, y: top)
        webView.frame.size = CGSize(
            width: UIScreen.main.bounds.width - left - right,
            height: UIScreen.main.bounds.height - top - bottom
        )
    }
}
