import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { verifyRuntimePolicy } from "../scripts/release-runtime-policy.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const samePath = (left, right) =>
  process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
const beneath = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    !!relative &&
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};
async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function noWithdrawal(folder) {
  for (const marker of ["WITHDRAWN.json", "WITHDRAWN-RUNTIME.json"]) {
    try {
      await fs.lstat(path.join(folder, marker));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw new Error("Package is withdrawn: " + marker);
  }
}
async function policyAt(root) {
  return JSON.parse(
    await fs.readFile(
      path.join(root, "packaging/runtime-security.json"),
      "utf8",
    ),
  );
}

// Permit an alias of the explicitly selected workspace root (for example a
// short Windows SUBST path), while rejecting links inside the payload itself.
export async function resolveQualifiedExecutable(root, requested) {
  const logicalReleaseRoot=path.resolve(root,'release');
  const releaseRoot=await fs.realpath(logicalReleaseRoot);
  if(!requested||!beneath(logicalReleaseRoot,requested)||path.basename(requested)!=='AciraBrowser.exe')
    throw new Error('Package executable must be inside this workspace release directory');
  const expected=path.join(releaseRoot,path.relative(logicalReleaseRoot,requested));
  const executable=await fs.realpath(requested);
  if(!beneath(releaseRoot,executable)||!samePath(expected,executable))
    throw new Error('Package path resolves outside its qualified payload');
  return {executable,requested};
}

export async function qualifyPackage({ root, reportName }) {
  if (!/^release-package-\d+\.json$/.test(reportName || ""))
    throw new Error("Invalid package qualification report name");
  const reportFile = path.join(root, "qa/artifacts", reportName),
    reportBytes = await fs.readFile(reportFile),
    report = JSON.parse(reportBytes);
  if (
    report.status !== "PASS" ||
    !/^[a-f0-9]{64}$/.test(report.sourceDigest || "")
  )
    throw new Error("Package has no passing source qualification");
  const requested =
      typeof report.actual?.exe === "string"
        ? path.resolve(report.actual.exe)
        : "";
  const {executable}=await resolveQualifiedExecutable(root,requested),
    folder = path.dirname(executable);
  await noWithdrawal(folder);
  const provenance = JSON.parse(
    await fs.readFile(path.join(folder, "ACIRA-PROVENANCE.json"), "utf8"),
  );
  if (provenance.sourceDigest !== report.sourceDigest)
    throw new Error("Package source digest differs from native report");
  if (
    provenance.runtimeQualification?.status !== "PASS" ||
    provenance.runtimeQualification.version !== provenance.electron
  )
    throw new Error("Package lacks a qualified runtime identity");
  const runtimeQualification = verifyRuntimePolicy({
    policy: await policyAt(root),
    version: provenance.electron,
    executableSha256: provenance.runtimeQualification.upstreamExecutableSha256,
  });
  if (report.actual?.runtime?.electron !== runtimeQualification.version)
    throw new Error(
      "Native package report runtime differs from current qualification",
    );
  const manifestBytes = await fs.readFile(
      path.join(folder, "FILES-SHA256.json"),
    ),
    manifestSha256 = sha(manifestBytes),
    manifest = JSON.parse(manifestBytes);
  if (
    report.packageManifestSha256 !== manifestSha256 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new Error(
      "Package payload manifest differs from native qualification",
    );
  let verifiedExecutable = false;
  for (const entry of manifest.files) {
    if (
      typeof entry.file !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 || "")
    )
      throw new Error("Invalid payload manifest entry");
    const payload = path.resolve(folder, entry.file);
    if (
      !beneath(folder, payload) ||
      !beneath(folder, await fs.realpath(payload))
    )
      throw new Error("Payload path escapes its package");
    if ((await fileHash(payload)) !== entry.sha256)
      throw new Error(
        "Package payload changed after native qualification: " + entry.file,
      );
    if (samePath(payload, executable)) verifiedExecutable = true;
  }
  if (!verifiedExecutable)
    throw new Error("Package executable is missing from its payload manifest");
  // Recheck policy/markers after hashing, not only at candidate discovery.
  await noWithdrawal(folder);
  verifyRuntimePolicy({
    policy: await policyAt(root),
    version: provenance.electron,
    executableSha256: provenance.runtimeQualification.upstreamExecutableSha256,
  });
  return {
    executable: requested,
    sourceDigest: report.sourceDigest,
    report: reportName,
    reportSha256: sha(reportBytes),
    packageManifestSha256: manifestSha256,
    runtimeQualification,
  };
}

export async function selectQualifiedPackages({ root, limit = 2 }) {
  const candidates = [],
    rejected = [];
  for (const reportName of (await fs.readdir(path.join(root, "qa/artifacts")))
    .filter((name) => /^release-package-\d+\.json$/.test(name))
    .sort()
    .reverse()) {
    try {
      const candidate = await qualifyPackage({ root, reportName });
      if (
        candidates.some(
          (item) =>
            samePath(item.executable, candidate.executable) ||
            item.sourceDigest === candidate.sourceDigest,
        )
      )
        continue;
      candidates.push(candidate);
      if (candidates.length === limit) break;
    } catch (error) {
      rejected.push({ report: reportName, reason: error.message });
    }
  }
  return { candidates, rejected };
}

export async function launchQualifiedPackage({
  root,
  candidate,
  options,
  launch,
}) {
  const current = await qualifyPackage({ root, reportName: candidate.report });
  if (
    current.reportSha256 !== candidate.reportSha256 ||
    !samePath(current.executable, candidate.executable) ||
    current.sourceDigest !== candidate.sourceDigest
  )
    throw new Error("Package selection changed before launch");
  return launch({ ...options, executablePath: current.executable });
}
