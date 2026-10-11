import type { DefaultSession } from "next-auth";
import type { RoleName } from "@/lib/permissions";

declare module "next-auth" {
  interface User {
    role: RoleName;
  }
  interface Session {
    user: { id: string; role: RoleName } & DefaultSession["user"];
  }
}
