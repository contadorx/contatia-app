"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOut() {
  const router = useRouter();
  async function out() {
    await createClient().auth.signOut();
    router.push("/login");
  }
  return (
    <button className="text-sm text-subtle hover:text-danger" onClick={out}>
      Sair
    </button>
  );
}
