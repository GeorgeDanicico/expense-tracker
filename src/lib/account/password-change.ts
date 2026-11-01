/**
 * The refusal every signed-in API route gives an account that must choose a new password first
 * (a kid account a parent created or reset; audit P4): `403 { error, code }`. Only `GET /api/account`,
 * `POST /api/account/password` and sign-out answer such an account normally. Pure, so the browser
 * can tell the refusal apart by its `code`.
 */
export const PASSWORD_CHANGE_REQUIRED = "password_change_required";

export const PASSWORD_CHANGE_REQUIRED_MESSAGE = "Choose a new password before you keep using the app.";

/** What a wrong current password answers, as the `currentPassword` field's error (422). */
export const WRONG_CURRENT_PASSWORD = "That isn't your current password.";

/** Where the browser goes to choose the new password. */
export const CHANGE_PASSWORD_PATH = "/change-password";
