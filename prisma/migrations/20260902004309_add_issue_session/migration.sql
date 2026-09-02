-- CreateTable
CREATE TABLE "IssueSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueOwner" TEXT NOT NULL,
    "issueRepo" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "topicId" TEXT,
    "planId" TEXT,
    "pendingStep" TEXT,
    "pendingPromptCommentId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueSession_issueOwner_issueRepo_issueNumber_key" ON "IssueSession"("issueOwner", "issueRepo", "issueNumber");
