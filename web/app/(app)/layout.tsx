import AppShell from "@/app/components/AppShell";

/** Every working screen renders inside the Workbench shell. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
