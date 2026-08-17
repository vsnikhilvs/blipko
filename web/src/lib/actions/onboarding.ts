"use server";

import { z } from "zod";
import { Bucket } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  DEFAULT_SPLIT,
  localeForCurrency,
  suggestCategoryBudgets,
  type SelectedLeaf,
} from "@/lib/budget";

// Groups pre-checked on first render of the wizard. Small list (not the whole
// taxonomy) — the taxonomy itself comes from the DB system categories.
const DEFAULT_GROUP_NAMES = new Set([
  "Essentials",
  "Food & Drinks",
  "Transportation",
  "Health & Wellness",
  "Savings",
]);

export interface OnboardingLeaf {
  name: string;
  bucket: Bucket;
  weight: number;
}

export interface OnboardingGroup {
  key: string; // system group row id
  name: string;
  bucket: Bucket;
  defaultSelected: boolean;
  children: OnboardingLeaf[];
}

// The category taxonomy for onboarding, sourced from the seeded system
// categories (userId = null) — single source of truth, no web-side duplicate.
export async function getOnboardingTaxonomy(): Promise<OnboardingGroup[]> {
  const session = await auth();
  if (!session?.user?.id) return [];

  const rows = await prisma.category.findMany({
    where: { userId: null },
    select: {
      id: true,
      name: true,
      bucket: true,
      isGroup: true,
      parentId: true,
      weight: true,
    },
    orderBy: { name: "asc" },
  });

  return rows
    .filter((r) => r.isGroup)
    .map((g) => ({
      key: g.id,
      name: g.name,
      bucket: g.bucket,
      defaultSelected: DEFAULT_GROUP_NAMES.has(g.name),
      children: rows
        .filter((r) => !r.isGroup && r.parentId === g.id)
        .map((r) => ({ name: r.name, bucket: r.bucket, weight: r.weight })),
    }))
    .filter((g) => g.children.length > 0);
}

const schema = z.object({
  monthlyIncome: z.number().positive().max(1_000_000_000),
  currency: z.string().min(1).max(8),
  payday: z.number().int().min(1).max(28).optional(),
  timezone: z.string().min(1).max(64).optional(), // IANA tz for scheduling
  notificationDosage: z.enum(["OFF", "GENTLE", "AGGRESSIVE", "RELENTLESS"]),
  // Individually-selected leaf category names (globally unique in the taxonomy).
  leafNames: z.array(z.string()).default([]),
});

export type SubmitOnboardingInput = z.infer<typeof schema>;

// Persists the whole onboarding wizard in one transaction: income + currency +
// reminder dosage on the User, a default 50/30/20 BudgetConfig, and the chosen
// leaf categories (resolved against the DB system taxonomy) cloned per-user with
// suggested budgets.
export async function submitOnboarding(
  input: SubmitOnboardingInput,
): Promise<{ success: boolean; message?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, message: "Unauthorized" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Invalid onboarding data",
    };
  }
  const d = parsed.data;
  const userId = session.user.id;

  // Resolve the selected leaf names against the system taxonomy (userId = null)
  // to get each leaf's bucket + weight + parent group. Unknown names ignored.
  const leafRows = d.leafNames.length
    ? await prisma.category.findMany({
        where: { userId: null, isGroup: false, name: { in: d.leafNames } },
        select: { name: true, bucket: true, weight: true, parentId: true },
      })
    : [];

  const parentIds = [
    ...new Set(
      leafRows.map((l) => l.parentId).filter((id): id is string => !!id),
    ),
  ];
  const parents = parentIds.length
    ? await prisma.category.findMany({
        where: { id: { in: parentIds } },
        select: { id: true, name: true, bucket: true },
      })
    : [];
  const parentById = new Map(parents.map((p) => [p.id, p]));

  const leaves: SelectedLeaf[] = leafRows.map((l) => ({
    name: l.name,
    bucket: l.bucket,
    weight: l.weight,
  }));
  const budgets = suggestCategoryBudgets(
    d.monthlyIncome,
    DEFAULT_SPLIT,
    leaves,
  );

  // Batch the category clone. A per-row findFirst/create loop is dozens of
  // sequential round-trips and blows Prisma Accelerate's 5s interactive
  // transaction timeout (P2028: "Transaction not found").
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          monthlyIncome: d.monthlyIncome,
          currency: d.currency,
          locale: localeForCurrency(d.currency),
          ...(d.payday !== undefined ? { payday: d.payday } : {}),
          ...(d.timezone ? { timezone: d.timezone } : {}),
          notificationDosage: d.notificationDosage,
          onboardingStep: null,
        },
      });

      await tx.budgetConfig.upsert({
        where: { userId },
        create: { userId, ...DEFAULT_SPLIT },
        update: {},
      });

      const groupsToCreate = parentIds.flatMap((parentId) => {
        const parent = parentById.get(parentId);
        if (!parent) return [];
        return [
          {
            userId,
            name: parent.name,
            bucket: parent.bucket,
            isGroup: true,
          },
        ];
      });
      if (groupsToCreate.length === 0) return;

      await tx.category.createMany({
        data: groupsToCreate,
        skipDuplicates: true,
      });

      const groupRows = await tx.category.findMany({
        where: {
          userId,
          isGroup: true,
          name: { in: groupsToCreate.map((g) => g.name) },
        },
        select: { id: true, name: true },
      });
      const groupIdByName = new Map(groupRows.map((g) => [g.name, g.id]));

      const leavesToCreate = leafRows.flatMap((leaf) => {
        const parent = leaf.parentId
          ? parentById.get(leaf.parentId)
          : undefined;
        const parentRowId = parent ? groupIdByName.get(parent.name) : undefined;
        if (!parentRowId) return [];
        return [
          {
            userId,
            name: leaf.name,
            bucket: leaf.bucket,
            parentId: parentRowId,
            monthlyBudget: budgets.get(leaf.name) ?? null,
          },
        ];
      });
      if (leavesToCreate.length === 0) return;

      await tx.category.createMany({
        data: leavesToCreate,
        skipDuplicates: true,
      });
    });
  } catch (error) {
    console.error("Error submitting onboarding:", error);
    return {
      success: false,
      message: "Couldn't save your setup — please try again.",
    };
  }

  // NOTE: hasOnboarded is set only when the wizard actually finishes (Telegram
  // step) via markOnboardingComplete — setting it here would flip the dashboard
  // flag mid-wizard and unmount the modal before step 4. Don't revalidate
  // /dashboard for the same reason.
  revalidatePath("/dashboard/categories");
  return { success: true };
}

// Marks onboarding complete once the user reaches the end of the wizard (after
// the Telegram step — whether they connect or tap "Do this later"). Kept
// separate from submitOnboarding so the flag flips only when the modal should
// actually close.
export async function markOnboardingComplete(): Promise<{ success: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { hasOnboarded: true },
  });

  revalidatePath("/dashboard");
  return { success: true };
}
