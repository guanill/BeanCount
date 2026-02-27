export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    // Protect everything except login page, auth API, and Next.js internals
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
