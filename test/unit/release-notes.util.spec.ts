import { buildReleaseNotesMarkdown } from 'src/modules/releases/release-notes.util';

describe('buildReleaseNotesMarkdown', () => {
  it('returns a placeholder when there are no completed issues yet', () => {
    const markdown = buildReleaseNotesMarkdown('v1.0.0', []);
    expect(markdown).toContain('v1.0.0');
    expect(markdown).toContain('No completed issues');
  });

  it('groups issues by issueType, alphabetically', () => {
    const markdown = buildReleaseNotesMarkdown('v2.0.0', [
      { issueKey: 'PRJ-3', title: 'Fix crash on save', issueType: 'Bug' },
      { issueKey: 'PRJ-1', title: 'Add dark mode', issueType: 'Story' },
      { issueKey: 'PRJ-2', title: 'Improve load time', issueType: 'Bug' },
    ]);

    const bugIndex = markdown.indexOf('## Bug');
    const storyIndex = markdown.indexOf('## Story');
    expect(bugIndex).toBeGreaterThan(-1);
    expect(storyIndex).toBeGreaterThan(-1);
    expect(bugIndex).toBeLessThan(storyIndex);
    expect(markdown).toContain('**PRJ-3** Fix crash on save');
    expect(markdown).toContain('**PRJ-2** Improve load time');
    expect(markdown).toContain('**PRJ-1** Add dark mode');
  });

  it('handles an issue with no issueKey gracefully', () => {
    const markdown = buildReleaseNotesMarkdown('v1.0.0', [
      { issueKey: null, title: 'Untracked fix', issueType: 'Task' },
    ]);
    expect(markdown).toContain('- Untracked fix');
  });

  it('includes the release name as the title', () => {
    const markdown = buildReleaseNotesMarkdown('My Release', [
      { issueKey: 'A-1', title: 'Something', issueType: 'Task' },
    ]);
    expect(markdown.startsWith('# My Release')).toBe(true);
  });
});
