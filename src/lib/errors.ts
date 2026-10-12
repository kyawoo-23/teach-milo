import {
  isTranslationKey,
  type TranslationKey,
  type TranslationParams,
} from "./i18n/messages";
export class AppError extends Error {
  public messageKey?: TranslationKey;
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryAfter?: number,
    messageKey?: TranslationKey,
    public params?: TranslationParams,
  ) {
    super(message);
    this.messageKey =
      messageKey ?? (isTranslationKey(message) ? message : undefined);
  }
}
