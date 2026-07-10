"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function withUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user_id: user?.id };
}

export async function completeTask(id: string) {
  const { supabase } = await withUser();
  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function skipTask(id: string) {
  const { supabase } = await withUser();
  const { error } = await supabase.from("tasks").update({ status: "skipped" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function snoozeTask(id: string, days: number) {
  const { supabase } = await withUser();
  const d = new Date();
  d.setDate(d.getDate() + (days || 1));
  const { error } = await supabase
    .from("tasks")
    .update({ due_date: d.toISOString().slice(0, 10) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}
