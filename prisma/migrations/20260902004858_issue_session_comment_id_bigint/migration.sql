/*
  Warnings:

  - You are about to alter the column `pendingPromptCommentId` on the `IssueSession` table. The data in that column could be lost. The data in that column will be cast from `Int` to `BigInt`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IssueSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueOwner" TEXT NOT NULL,
    "issueRepo" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "topicId" TEXT,
    "planId" TEXT,
    "pendingStep" TEXT,
    "pendingPromptCommentId" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_IssueSession" ("createdAt", "id", "issueNumber", "issueOwner", "issueRepo", "pendingPromptCommentId", "pendingStep", "planId", "topicId", "updatedAt") SELECT "createdAt", "id", "issueNumber", "issueOwner", "issueRepo", "pendingPromptCommentId", "pendingStep", "planId", "topicId", "updatedAt" FROM "IssueSession";
DROP TABLE "IssueSession";
ALTER TABLE "new_IssueSession" RENAME TO "IssueSession";
CREATE UNIQUE INDEX "IssueSession_issueOwner_issueRepo_issueNumber_key" ON "IssueSession"("issueOwner", "issueRepo", "issueNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
