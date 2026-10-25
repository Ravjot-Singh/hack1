-- CreateTable
CREATE TABLE "PlacementDrive" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "attending" JSONB NOT NULL DEFAULT '[]',
    "rolls" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementDrive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementRound" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startPeriod" INTEGER NOT NULL,
    "endPeriod" INTEGER NOT NULL,
    "roomId" TEXT,
    "bookingId" TEXT,

    CONSTRAINT "PlacementRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlacementDrive_institutionId_idx" ON "PlacementDrive"("institutionId");

-- CreateIndex
CREATE INDEX "PlacementRound_driveId_idx" ON "PlacementRound"("driveId");

-- AddForeignKey
ALTER TABLE "PlacementDrive" ADD CONSTRAINT "PlacementDrive_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementRound" ADD CONSTRAINT "PlacementRound_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "PlacementDrive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
