import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTask } from "./validate-backlog.ts";

const task = (front: string, body = "## Goal\nx\n## Acceptance criteria\n- y\n## Verify\nnpm run verify\n") =>
    `---\nid: p1-a\ntitle: A task\nphase: P1\n${front}---\n${body}`;
const ids = new Set(["p1-a", "p1-b"]);

test("a well-formed task passes", () => {
    assert.deepEqual(checkTask("backlog/tasks/p1-a.md", task("depends_on: [p1-b]\nmodel: sonnet\n"), ids), []);
});

test("problems are named", () => {
    const problems = checkTask("backlog/tasks/p1-x.md", task("depends_on: [p9-nope]\nmodel: gpt\nfoo: 1\n", "## Goal\n"), ids);
    for (const p of ["doesn't match the file name", "unknown task: p9-nope", "model must be", "unknown key: foo", "## Verify"]) {
        assert.ok(problems.some((x) => x.includes(p)), `${p} in ${problems.join("; ")}`);
    }
});

test("frontmatter is required", () => {
    assert.deepEqual(checkTask("backlog/tasks/p1-a.md", "# no frontmatter", ids), ["missing --- frontmatter ---"]);
});
