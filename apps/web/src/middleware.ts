import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

const privada = createRouteMatcher(["/painel(.*)", "/simulado(.*)"]);
const clerk = clerkMiddleware(async (auth, req) => {
  if (privada(req)) await auth.protect();
});

export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  // Demonstração local sem login. Em produção/teste NODE_ENV é "production": este desvio nunca vale (e modoDemo() recusa DEMO=1).
  if (process.env.DEMO === "1" && process.env.NODE_ENV !== "production") return NextResponse.next();
  return clerk(req, ev);
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
