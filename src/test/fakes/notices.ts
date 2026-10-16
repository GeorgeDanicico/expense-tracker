import type { AccountNotice, NoticeRepository } from "@/lib/account/notice-repository";
import { DomainError } from "@/lib/errors";

/**
 * In-memory `NoticeRepository` for the signed-in caller. Push notices onto `notices`; `dismiss`
 * marks one as seen by adding its id to `seen`, and `listUnseen` leaves seen ones out.
 */
export class FakeNoticeRepository implements NoticeRepository {
  readonly notices: AccountNotice[] = [];
  readonly seen = new Set<string>();
  readonly calls: string[] = [];

  async listUnseen() {
    this.calls.push("listUnseen");
    return this.notices
      .filter((notice) => !this.seen.has(notice.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async dismiss(noticeId: string) {
    this.calls.push("dismiss");
    if (!this.notices.some((notice) => notice.id === noticeId)) throw new DomainError("Notice not found.", 404);
    this.seen.add(noticeId);
  }
}
