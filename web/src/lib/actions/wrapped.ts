"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Bucket } from "@prisma/client";
import { BUCKETS, BUCKET_META, currentMonthRange } from "@/lib/budget";
import { DEFAULT_TZ, isMonthEndWindow, zonedParts } from "@/lib/time";

export type WrappedBucketSlice = {
  bucket: Bucket;
  amount: number;
  pct: number; // share of total spend, 0–100
};

export type WrappedStats = {
  monthLabel: string; // e.g. "July"
  year: number;
  currency: string;
  totalSpent: number;
  totalIncome: number;
  netSaved: number; // income − spend (may be negative)
  savingsRatePct: number; // netSaved / income, 0 when no income
  bucketSplit: WrappedBucketSlice[]; // always 3 slices, BUCKETS order
  topCategory: { name: string; icon: string | null; amount: number } | null;
  biggestExpense: { label: string; category: string; amount: number } | null;
  txnCount: number;
};

// The current calendar month, "wrapped" — a shareable recap of what the user
// spent, saved and splurged on. Calendar-month scoped (not the payday cycle) so
// the numbers match the month name on the card.
//
// Returns null when there is nothing to announce: outside the last few days of
// the month, or when the month has no transactions. The user lookup runs first
// precisely so the window check can bail before the six aggregate queries.
export async function getWrappedStats(): Promise<WrappedStats | null> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }
  const userId = session.user.id;
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currency: true, timezone: true },
  });
  const tz = user?.timezone ?? DEFAULT_TZ;
  if (!isMonthEndWindow(now, tz)) return null;

  // Name the card's month with the same clock that decided to show it.
  const { year, month } = zonedParts(now, tz);

  const { start, end } = currentMonthRange(now);
  const where = { userId, isDeleted: false, date: { gte: start, lt: end } };

  const [bucketGroups, incomeAgg, biggest, txnCount, categoryGroups] =
    await Promise.all([
      prisma.expense.groupBy({
        by: ["bucket"],
        _sum: { amount: true },
        where,
      }),
      prisma.income.aggregate({ _sum: { amount: true }, where }),
      prisma.expense.findFirst({
        where,
        orderBy: { amount: "desc" },
        select: {
          amount: true,
          note: true,
          rawText: true,
          bucket: true,
          category: { select: { name: true } },
        },
      }),
      prisma.expense.count({ where }),
      prisma.expense.groupBy({
        by: ["categoryId"],
        _sum: { amount: true },
        where,
        orderBy: { _sum: { amount: "desc" } },
        take: 1,
      }),
    ]);

  if (txnCount === 0) return null;

  const currency = user?.currency ?? "INR";

  const spentByBucket = new Map<Bucket, number>();
  for (const g of bucketGroups) {
    spentByBucket.set(g.bucket as Bucket, Number(g._sum.amount ?? 0));
  }
  const totalSpent = [...spentByBucket.values()].reduce((s, v) => s + v, 0);

  const bucketSplit: WrappedBucketSlice[] = BUCKETS.map((bucket) => {
    const amount = spentByBucket.get(bucket) ?? 0;
    return {
      bucket,
      amount,
      pct: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0,
    };
  });

  const totalIncome = Number(incomeAgg._sum.amount ?? 0);
  const netSaved = totalIncome - totalSpent;
  const savingsRatePct =
    totalIncome > 0 ? Math.round((netSaved / totalIncome) * 100) : 0;

  // Top category by spend (skip uncategorized rows).
  let topCategory: WrappedStats["topCategory"] = null;
  const topGroup = categoryGroups[0];
  if (topGroup?.categoryId) {
    const cat = await prisma.category.findUnique({
      where: { id: topGroup.categoryId },
      select: { name: true, icon: true },
    });
    if (cat) {
      topCategory = {
        name: cat.name,
        icon: cat.icon,
        amount: Number(topGroup._sum.amount ?? 0),
      };
    }
  }

  const biggestExpense = biggest
    ? {
        label:
          biggest.note?.trim() ||
          biggest.category?.name ||
          biggest.rawText.trim() ||
          "A mystery buy",
        category: biggest.category?.name ?? BUCKET_META[biggest.bucket].label,
        amount: Number(biggest.amount),
      }
    : null;

  return {
    monthLabel: new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
      "en-US",
      { month: "long", timeZone: "UTC" },
    ),
    year,
    currency,
    totalSpent,
    totalIncome,
    netSaved,
    savingsRatePct,
    bucketSplit,
    topCategory,
    biggestExpense,
    txnCount,
  };
}
