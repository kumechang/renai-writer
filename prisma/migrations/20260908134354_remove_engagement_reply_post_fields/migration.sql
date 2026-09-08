/*
  Warnings:

  - You are about to drop the column `failureReason` on the `EngagementReply` table. All the data in the column will be lost.
  - You are about to drop the column `tweetId` on the `EngagementReply` table. All the data in the column will be lost.
  - You are about to drop the column `tweetUrl` on the `EngagementReply` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EngagementReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchedPostId" TEXT NOT NULL,
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
    "feedbackNotes" TEXT,
    "feedbackBy" TEXT,
    "feedbackAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EngagementReply_watchedPostId_fkey" FOREIGN KEY ("watchedPostId") REFERENCES "WatchedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EngagementReply" ("approvedBy", "createdAt", "feedbackAt", "feedbackBy", "feedbackNotes", "finalText", "generatedText", "githubIssueNumber", "githubIssueOwner", "githubIssueRepo", "githubIssueUrl", "id", "rejectedBy", "rejectionReason", "selfCheckJson", "status", "updatedAt", "watchedPostId") SELECT "approvedBy", "createdAt", "feedbackAt", "feedbackBy", "feedbackNotes", "finalText", "generatedText", "githubIssueNumber", "githubIssueOwner", "githubIssueRepo", "githubIssueUrl", "id", "rejectedBy", "rejectionReason", "selfCheckJson", "status", "updatedAt", "watchedPostId" FROM "EngagementReply";
DROP TABLE "EngagementReply";
ALTER TABLE "new_EngagementReply" RENAME TO "EngagementReply";
CREATE UNIQUE INDEX "EngagementReply_watchedPostId_key" ON "EngagementReply"("watchedPostId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
