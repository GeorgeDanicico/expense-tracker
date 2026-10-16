export type NoticeKind = "family_deleted" | "removed_from_family";

/** A one-off message for the signed-in user, shown until they dismiss it. */
export type AccountNotice = {
  id: string;
  kind: NoticeKind;
  /** The family's name when the notice was written; the family itself may be gone. */
  familyName: string;
  createdAt: string;
};

/** Account notices of the signed-in caller. Get it from `getRepositories()`; never import an implementation. */
export interface NoticeRepository {
  /** The caller's unseen notices, oldest first. */
  listUnseen(): Promise<AccountNotice[]>;
  /** Marks one of the caller's notices as seen. Throws a 404 `DomainError` for an unknown id or another user's notice. */
  dismiss(noticeId: string): Promise<void>;
}
