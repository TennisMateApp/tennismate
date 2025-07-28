"use client";

import withAuth from "@/components/withAuth";
import DirectoryPage from "./DirectoryPage";

const Protected = withAuth(DirectoryPage);

console.log("✅ ProtectedDirectoryPage is exporting a component:", typeof Protected);

export default Protected;
