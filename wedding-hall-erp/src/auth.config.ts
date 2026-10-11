import type { NextAuthConfig } from "next-auth";
import { canAccess, isRoleName } from "@/lib/permissions";

// إعدادات آمنة للـ Edge (بدون Prisma / bcrypt) تُستخدم في الـ middleware.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // 8 ساعات
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const { pathname } = nextUrl;
      const role = auth?.user?.role;
      const loggedIn = !!auth?.user && isRoleName(role);

      if (pathname === "/login") {
        return loggedIn ? Response.redirect(new URL("/dashboard", nextUrl)) : true;
      }
      if (pathname === "/forbidden") return loggedIn;
      if (!loggedIn) {
        if (pathname.startsWith("/api/")) {
          return Response.json({ error: "غير مصرّح" }, { status: 401 });
        }
        return false; // يحوّل لصفحة الدخول
      }

      if (pathname === "/") return Response.redirect(new URL("/dashboard", nextUrl));
      if (pathname.startsWith("/api/")) return true; // كل API يتحقق بنفسه
      if (!canAccess(role, pathname)) {
        return Response.redirect(new URL("/forbidden", nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      if (token.role) session.user.role = token.role as never;
      return session;
    },
  },
} satisfies NextAuthConfig;
