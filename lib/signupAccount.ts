export const SIGNUP_PASSWORD_ERROR =
  "Your password must be at least 6 characters and include a number and a special character.";

export function getSignupPasswordRequirements(password: string) {
  return {
    length: password.length >= 6,
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export function isSignupPasswordValid(password: string) {
  return Object.values(getSignupPasswordRequirements(password)).every(Boolean);
}

export type SignupErrorField = "email" | "password" | null;

export type SignupErrorMessage = {
  message: string;
  field: SignupErrorField;
  showAccountActions: boolean;
};

const UNKNOWN_SIGNUP_ERROR =
  "Something went wrong while creating your account. Please try again. If the problem continues, contact TennisMate support.";

export function mapSignupAuthError(code: string | undefined): SignupErrorMessage {
  switch (code) {
    case "auth/email-already-in-use":
      return {
        message: "An account already exists with this email address. Sign in or reset your password.",
        field: "email",
        showAccountActions: true,
      };
    case "auth/invalid-email":
      return {message: "Enter a valid email address.", field: "email", showAccountActions: false};
    case "auth/weak-password":
      return {message: SIGNUP_PASSWORD_ERROR, field: "password", showAccountActions: false};
    case "auth/network-request-failed":
      return {
        message: "We couldn’t connect to TennisMate. Check your internet connection and try again.",
        field: null,
        showAccountActions: false,
      };
    case "auth/too-many-requests":
      return {
        message: "Too many attempts have been made. Wait a few minutes and try again.",
        field: null,
        showAccountActions: false,
      };
    case "auth/operation-not-allowed":
      return {
        message: "Account creation is temporarily unavailable. Please try again later.",
        field: null,
        showAccountActions: false,
      };
    case "auth/user-disabled":
      return {
        message: "This account cannot currently be used. Contact TennisMate support for assistance.",
        field: null,
        showAccountActions: false,
      };
    case "auth/invalid-continue-uri":
    case "auth/missing-continue-uri":
    case "auth/unauthorized-continue-uri":
    case "auth/unauthorized-domain":
      return {
        message: "We couldn’t send the verification email. Please try again later or contact TennisMate support.",
        field: null,
        showAccountActions: false,
      };
    case "auth/expired-action-code":
    case "auth/invalid-action-code":
      return {
        message: "That verification link is no longer valid. Request a new email and try again.",
        field: null,
        showAccountActions: false,
      };
    default:
      return {message: UNKNOWN_SIGNUP_ERROR, field: null, showAccountActions: false};
  }
}

export function emailDomainOnly(email: string) {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  return at > 0 && at < normalized.length - 1 ? normalized.slice(at + 1) : "unknown";
}

export function signupFailureDiagnostics(input: {
  code?: string;
  method?: string;
  route?: string;
  platform?: string;
  appVersion?: string;
  clientValidationPassed: boolean;
  email: string;
  stage: "authentication" | "account_setup";
}) {
  return {
    firebase_error_code: input.code || "unknown",
    signup_method: input.method || "email_password",
    platform: input.platform || "unknown",
    app_version: input.appVersion || "unknown",
    current_route: input.route || "unknown",
    client_validation_passed: input.clientValidationPassed,
    email_domain: emailDomainOnly(input.email),
    failure_stage: input.stage,
  };
}
