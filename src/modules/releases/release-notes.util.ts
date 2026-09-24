export interface ReleaseNoteIssue {
  issueKey: string | null;
  title: string;
  issueType: string;
}

/**
 * Module 2's "AI-written release notes" (BRD) - deliberately a deterministic composer built from
 * real completed-issue data, NOT a real LLM call. No LLM provider exists anywhere in this
 * codebase (the one precedent, CommentForm's "AI Suggest" button, is a hardcoded string picker,
 * not a real integration) - this generates a genuinely useful markdown summary honestly, rather
 * than faking an "AI" label on a stub. Groups issues by their issueType (alphabetically, since
 * issueType is a free-form, per-project-customizable string - see issue-type.schema.ts - so no
 * fixed "Bug Fixes"/"Features" ordering can be assumed here).
 */
export function buildReleaseNotesMarkdown(releaseName: string, issues: ReleaseNoteIssue[]): string {
  if (issues.length === 0) {
    return `# ${releaseName}\n\nNo completed issues are tagged with this release yet.`;
  }

  const byType = new Map<string, ReleaseNoteIssue[]>();
  for (const issue of issues) {
    const bucket = byType.get(issue.issueType) ?? [];
    bucket.push(issue);
    byType.set(issue.issueType, bucket);
  }

  const sections = [...byType.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((issueType) => {
      const lines = byType
        .get(issueType)!
        .map((issue) => `- ${issue.issueKey ? `**${issue.issueKey}** ` : ''}${issue.title}`)
        .join('\n');
      return `## ${issueType}\n\n${lines}`;
    });

  return `# ${releaseName}\n\n${sections.join('\n\n')}`;
}
