"use client";

import { useEffect } from "react";
import { loadBrand } from "@/lib/brand";

/** Fetch and apply the organisation's branding on every page, signed in or not. */
export function BrandSync() {
  useEffect(() => { void loadBrand(); }, []);
  return null;
}
