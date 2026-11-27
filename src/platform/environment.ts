// Which copy of the platform this server is: APP_ENV=staging on the QA environment (docs/HANDOVER.md, "Environments
// and releases"); unset or anything else is production. Read per request (call connection() first in components),
// so a value set on the server is never frozen into a page at build time.
export type AppStage = "production" | "staging";

export const appStage = (): AppStage => (process.env.APP_ENV === "staging" ? "staging" : "production");
export const isStaging = () => appStage() === "staging";

/** Height of the staging banner; the app shell moves its sticky parts down by it (CSS variable --stage-h). */
export const STAGE_BANNER_PX = 28;
