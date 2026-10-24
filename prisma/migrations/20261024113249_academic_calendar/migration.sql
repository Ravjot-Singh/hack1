-- CreateEnum
CREATE TYPE "CalendarKind" AS ENUM ('HOLIDAY', 'EXAM', 'FOLLOWS');

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "termEnd" DATE,
ADD COLUMN     "termStart" DATE;

-- CreateTable
CREATE TABLE "CalendarDay" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "CalendarKind" NOT NULL,
    "label" TEXT NOT NULL,
    "followsDay" INTEGER,

    CONSTRAINT "CalendarDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarDay_institutionId_date_key" ON "CalendarDay"("institutionId", "date");

-- AddForeignKey
ALTER TABLE "CalendarDay" ADD CONSTRAINT "CalendarDay_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
