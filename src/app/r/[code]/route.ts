import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// /r/{code} → grava cookie de atribuição (90 dias) e manda pra home.
// Quando o cadastro self-serve existir, o cookie vira tenants.referred_by.
export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const res = NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
  res.cookies.set("contatia_ref", params.code, {
    maxAge: 90 * 24 * 60 * 60,
    httpOnly: false,
    path: "/",
    sameSite: "lax",
  });
  return res;
}
