-- CreateTable
CREATE TABLE "RoomDowntime" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "periods" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomDowntime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMove" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "versionId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomDowntime_institutionId_toDate_idx" ON "RoomDowntime"("institutionId", "toDate");

-- CreateIndex
CREATE INDEX "RoomMove_institutionId_date_idx" ON "RoomMove"("institutionId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMove_institutionId_date_lessonId_key" ON "RoomMove"("institutionId", "date", "lessonId");

-- AddForeignKey
ALTER TABLE "RoomDowntime" ADD CONSTRAINT "RoomDowntime_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomDowntime" ADD CONSTRAINT "RoomDowntime_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMove" ADD CONSTRAINT "RoomMove_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
