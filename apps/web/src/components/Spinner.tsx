"use client";
import { useEffect, useState } from "react";

const QUADROS = ["|", "/", "-", "\\"];

/** Spinner ASCII (| / - \). Com movimento reduzido vira "..." estático. */
export function Spinner() {
  const [i, setI] = useState(0);
  const [reduzido, setReduzido] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduzido(mq.matches);
    if (mq.matches) return;
    const t = setInterval(() => setI((v) => (v + 1) % QUADROS.length), 110);
    return () => clearInterval(t);
  }, []);
  return <span aria-hidden="true">{reduzido ? "..." : QUADROS[i]}</span>;
}
