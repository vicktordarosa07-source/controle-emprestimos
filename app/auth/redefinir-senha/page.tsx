import { redirect } from "next/navigation";
import { PasswordResetPanel } from "@/app/components/PasswordResetPanel";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function RedefinirSenhaPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  return <PasswordResetPanel />;
}
