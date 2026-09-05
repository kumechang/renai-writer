-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_XPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT,
    "draftId" TEXT,
    "articleUrl" TEXT,
    "generatedText" TEXT NOT NULL,
    "finalText" TEXT NOT NULL,
    "selfCheckJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "githubIssueOwner" TEXT,
    "githubIssueRepo" TEXT,
    "githubIssueNumber" INTEGER,
    "githubIssueUrl" TEXT,
    "approvedBy" TEXT,
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "tweetId" TEXT,
    "tweetUrl" TEXT,
    "failureReason" TEXT,
    "feedbackNotes" TEXT,
    "feedbackBy" TEXT,
    "feedbackAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "XPost_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_XPost" ("approvedBy", "articleId", "articleUrl", "createdAt", "draftId", "failureReason", "feedbackAt", "feedbackBy", "feedbackNotes", "finalText", "generatedText", "githubIssueNumber", "githubIssueOwner", "githubIssueRepo", "githubIssueUrl", "id", "rejectedBy", "rejectionReason", "selfCheckJson", "status", "tweetId", "tweetUrl", "updatedAt") SELECT "approvedBy", "articleId", "articleUrl", "createdAt", "draftId", "failureReason", "feedbackAt", "feedbackBy", "feedbackNotes", "finalText", "generatedText", "githubIssueNumber", "githubIssueOwner", "githubIssueRepo", "githubIssueUrl", "id", "rejectedBy", "rejectionReason", "selfCheckJson", "status", "tweetId", "tweetUrl", "updatedAt" FROM "XPost";
DROP TABLE "XPost";
ALTER TABLE "new_XPost" RENAME TO "XPost";
CREATE INDEX "XPost_articleId_idx" ON "XPost"("articleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
