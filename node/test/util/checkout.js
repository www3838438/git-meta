/*
 * Copyright (c) 2016, Two Sigma Open Source
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * * Neither the name of git-meta nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
"use strict";

const assert  = require("chai").assert;
const co      = require("co");

const Checkout        = require("../../lib/util/checkout");
const GitUtil         = require("../../lib/util/git_util");
const RepoASTTestUtil = require("../../lib/util/repo_ast_test_util");
const UserError       = require("../../lib/util/user_error");

describe("Checkout", function () {
    describe("findTrackingBranch", function () {
        const cases = {
            "simple miss": {
                state: "x=S",
                name: "foo",
                expected: null,
            },
            "miss, but is a remote": {
                state: "a=B|x=Ca",
                name: "foo",
                expected: null,
            },
            "miss, but is branch": {
                state: "x=S:Bfoo=1",
                name: "foo",
                expected: null,
            },
            "hit": {
                state: "a=B:Byou=1|x=Ca",
                name: "you",
                expected: "origin",
            },
            "hit, more than one remote": {
                state: "b=B:Bme=1|a=B:Byou=1|x=Ca:Rupstream=b",
                name: "you",
                expected: "origin",
            },
            "hit, non-origin": {
                state: "b=B:Bme=1|a=B:Byou=1|x=Ca:Rupstream=b me=1",
                name: "me",
                expected: "upstream",
            },
            "miss, non-unique": {
                state: "b=B:Bme=1|a=B:Bme=1|x=Ca:Rupstream=b me=1",
                name: "me",
                expected: null,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const w = yield RepoASTTestUtil.createMultiRepos(c.state);
                const repo = w.repos.x;
                const result = yield Checkout.findTrackingBranch(repo, c.name);
                assert.equal(result, c.expected);
            }));
        });
    });
    describe("checkoutCommit", function () {
        // We will operate on the repository `x`.

        const cases = {
            "simple checkout with untracked file": {
                input: "x=S:Bfoo=1;W car=bmw",
                expected: "x=E:H=1",
                committish: "foo",
            },
            "simple checkout with unrelated change": {
                input: "x=S:C2-1;Bfoo=2;W README.md=meh",
                committish: "foo",
                expected: "x=E:H=2",
            },
            "checkout new commit": {
                input: "x=S:C2-1;Bfoo=2",
                committish: "foo",
                expected: "x=E:H=2",
            },
            "checkout with conflict": {
                input: "x=S:C2-1;Bfoo=2;W 2=meh",
                committish: "foo",
                fails: true,
            },
            "checkout with conflict, but forced": {
                input: "x=S:C2-1;Bfoo=2;W 2=meh",
                committish: "foo",
                expected: "x=E:H=2;W 2=~",
                force: true,
            },
            "sub closed": {
                input: "a=S|x=U:Bfoo=2",
                committish: "foo",
                expected: "x=E:H=2",
            },
            "sub closed, but different commit": {
                input: "a=S:C4-1;Bmeh=4|x=U:C3-2 s=Sa:4;Bfoo=3",
                committish: "foo",
                expected: "x=E:H=3",
            },
            "open sub but no change": {
                input: "a=S|x=U:Os;Bfoo=2",
                committish: "foo",
                expected: "x=E:H=2",
            },
            "open sub but no change to sub": {
                input: "a=S|x=U:C4-2;Os;Bfoo=4",
                committish: "foo",
                expected: "x=E:H=4",
            },
            "sub open, different commit": {
                input: "a=S:C4-1;Bmeh=4|x=U:C3-2 s=Sa:4;Bfoo=3;Os",
                committish: "foo",
                expected: "x=E:H=3;Os H=4",
            },
            "sub open, new commit": {
                input: "a=S:C4-1;Bmeh=4|x=U:C3-2 s=Sa:4;Bfoo=3;Os C5-1!H=5",
                committish: "foo",
                fails: true,
            },
            "sub open, new commit but same": {
                input: "a=S:C4-1;Bmeh=4|x=U:C3-2 s=Sa:4;Bfoo=3;Os H=4",
                committish: "foo",
                expected: "x=E:H=3",
            },
            "sub open, new commit in index, but same": {
                input: `
a=S:C4-1;Bmeh=4;C5-1;Bbah=5|x=U:C3-2 s=Sa:4;Bfoo=3;I s=Sa:4`,
                committish: "foo",
                expected: "x=E:H=3;I s=~",
            },
            "sub open, new commit forced": {
                input: "a=S:C4-1;Bmeh=4|x=U:C3-2 s=Sa:4;Bfoo=3;Os C5-1!H=5",
                committish: "foo",
                expected: "x=E:H=3;Os H=4",
                force: true,
            },
            "sub open, new commit in index forced": {
                input: `
a=S:C4-1;Bmeh=4;C5-1;Bbah=5|x=U:C3-2 s=Sa:4;Bfoo=3;I s=Sa:5`,
                committish: "foo",
                expected: "x=E:H=3;I s=~",
                force: true,
            },
            "sub open, new overlapping commit": {
                input: `
a=S:C4-1;Bmeh=4|x=U:C3-2 s=Sa:4;Bfoo=3;Os C5-1 3=x!H=5`,
                committish: "foo",
                fails: true,
            },
            "sub open, new overlapping commit forced": {
                input: `
a=S:C4-1;Bmeh=4|x=U:C3-2 s=Sa:4;Bfoo=3;Os C5-1 3=x!H=5`,
                committish: "foo",
                force: true,
                expected: "x=E:H=3;Os H=4",
            },
            "overlapping change failure": {
                input: "\
a=S:C4-1 README.md=q;Bmeh=4|\
x=U:C3-2 s=Sa:4;Bfoo=3;Os W README.md=r",
                committish: "foo",
                fails: true,
            },
            "overlapping change force": {
                input: "\
a=S:C4-1 README.md=q;Bmeh=4|\
x=U:C3-2 s=Sa:4;Bfoo=3;Os W README.md=r",
                committish: "foo",
                expected: "x=E:H=3;Os",
                force: true,
            },
            "non-overlapping change success": {
                input: "\
a=S:C4-1 README.md=q;Bmeh=4|\
x=U:C3-2 s=Sa:4;Bfoo=3;Os W bar=r",
                committish: "foo",
                expected: "x=E:H=3;Os H=4!W bar=r",
            },
            "checkout revision missing a sub": {
                input: `
a=B|x=S:C2-1 s=Sa:1;C3-2 r=Sa:1,t=Sa:1;Or;Os;Ot;Bmaster=3;Bfoo=2`,
                expected: `
a=B|x=S:C2-1 s=Sa:1;C3-2 r=Sa:1,t=Sa:1;Os;Bmaster=3;Bfoo=2;H=2`,
                committish: "foo",
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const manipulator = co.wrap(function *(repos) {
                    const repo = repos.x;
                    const annotated = yield GitUtil.resolveCommitish(
                                                                 repo,
                                                                 c.committish);
                    assert.isNotNull(annotated);
                    const commit = yield repo.getCommit(annotated.id());
                    const force = c.force || false;
                    yield Checkout.checkoutCommit(repo, commit, force);
                });
                yield RepoASTTestUtil.testMultiRepoManipulator(c.input,
                                                               c.expected,
                                                               manipulator,
                                                               c.fails);
            }));
        });
    });
    describe("deriveCheckoutOperation", function () {
        const cases = {
            // wouldn't have this case in reality, but is in contract

            "nothing": {
                state: "x=S",
                expectedSha: null,
                expectedNewBranch: null,
                expectedSwitchBranch: null,
            },
            "tracking, without a new branch": {
                state: "x=S:Rmeh=/a foo=1",
                committish: "meh/foo",
                track: true,
                expectedSha: "1",
                expectedNewBranch: {
                    name: "foo",
                    tracking: {
                        remoteName: "meh",
                        branchName: "foo",
                    },
                },
                expectedSwitchBranch: "foo",
            },
            "tracking, without a new branch, but dupe name": {
                state: "x=S:Rmeh=/a master=1",
                committish: "meh/master",
                track: true,
                fails: true,
            },
            "tracking, without a new branch, but bad committish": {
                state: "x=S:Rmeh=/a master=1",
                committish: "origin/master",
                track: true,
                fails: true,
            },
            "no name": {
                state: "x=S",
                committish: null,
                track: true,
                fails: true,
            },
            "deduced tracking branch": {
                state: "x=S:Rfoo=/a bar=1",
                committish: "bar",
                track: false,
                expectedSha: "1",
                expectedNewBranch: {
                    name: "bar",
                    tracking: {
                        remoteName: "foo",
                        branchName: "bar",
                    },
                },
                expectedSwitchBranch: "bar",
            },
            "no match to committish, no new branch": {
                state: "x=S",
                committish: "bar",
                track: false,
                fails: true,
            },
            "commit, no new branch, nameless": {
                state: "x=S",
                committish: "1",
                track: false,
                expectedSha: "1",
                expectedNewBranch: null,
                expectedSwitchBranch: null,
            },
            "commit, no new branch, named": {
                state: "x=S",
                committish: "master",
                track: false,
                expectedSha: "1",
                expectedNewBranch: null,
                expectedSwitchBranch: "master",
            },
            "FETCH_HEAD": {
                state: "x=S",
                committish: "FETCH_HEAD",
                track: false,
                expectedSha: "1",
                expectedNewBranch: null,
                expectedSwitchBranch: null,
            },
            "HEAD": {
                state: "x=S",
                committish: "HEAD",
                track: false,
                expectedSha: "1",
                expectedNewBranch: null,
                expectedSwitchBranch: null,
            },
            "commit, no new branch, named but remote": {
                state: "x=S:Rorigin=/a foo=1",
                committish: "foo",
                track: false,
                expectedSha: "1",
                expectedNewBranch: {
                    name: "foo",
                    tracking: {
                        branchName: "foo",
                        remoteName: "origin",
                    },
                },
                expectedSwitchBranch: "foo",
            },
            "no commit, detached": {
                state: "x=S:H=1",
                committish: null,
                expectedSha: null,
                expectedNewBranch: null,
                expectedSwitchBranch: null,
            },
            "new branch, but a dupe": {
                state: "x=S",
                newBranch: "master",
                fails: true,
            },
            "new branch": {
                state: "x=S",
                newBranch: "foo",
                expectedSha: null,
                expectedNewBranch: {
                    name: "foo",
                    tracking: null,
                },
                expectedSwitchBranch: "foo",
            },
            "new branch with checkout": {
                state: "x=S:C2-1;Bbar=2",
                committish: "bar",
                newBranch: "foo",
                expectedSha: "2",
                expectedNewBranch: {
                    name: "foo",
                    tracking: null,
                },
                expectedSwitchBranch: "foo",
            },
            "new branch with local tracking": {
                state: "x=S:C2-1;Bbar=2",
                committish: "bar",
                newBranch: "foo",
                track: true,
                expectedSha: "2",
                expectedNewBranch: {
                    name: "foo",
                    tracking: {
                        remoteName: null,
                        branchName: "bar",
                    },
                },
                expectedSwitchBranch: "foo",
            },
            "new branch with remote tracking": {
                state: "x=S:Rhar=/a hey=1",
                committish: "har/hey",
                newBranch: "foo",
                track: true,
                expectedSha: "1",
                expectedNewBranch: {
                    name: "foo",
                    tracking: {
                        remoteName: "har",
                        branchName: "hey",
                    },
                },
                expectedSwitchBranch: "foo",
            },
            "tracking on new branch but commit not a branch": {
                state: "x=S",
                committish: "1",
                newBranch: "har",
                track: true,
                fails: true,
            },
            "tracking on new branch but head not a branch": {
                state: "x=S:H=1",
                committish: null,
                newBranch: "har",
                track: true,
                fails: true,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const written =
                               yield RepoASTTestUtil.createMultiRepos(c.state);
                const repo = written.repos.x;
                let committish = c.committish || null;

                // If the test case is a sha, we need to map it to the real
                // thing.

                const reverse = written.reverseCommitMap;
                if (null !== committish && committish in reverse) {
                    committish = reverse[committish];
                }
                const newBranch = c.newBranch || null;
                const track = c.track || false;
                let result;
                try {
                    result = yield Checkout.deriveCheckoutOperation(repo,
                                                                    committish,
                                                                    newBranch,
                                                                    track);
                }
                catch (e) {
                    if (!c.fails || !(e instanceof UserError)) {
                        throw e;
                    }
                    return;
                }
                assert(!c.fails, "was supposed to fail");
                const expectedSha = c.expectedSha;
                const commit = result.commit;
                if (null !== expectedSha) {
                    assert.isNotNull(commit);
                    const commitId = commit.id().tostrS();
                    const sha = written.commitMap[commitId];
                    assert.equal(sha, c.expectedSha);
                }
                else {
                    assert.isNull(commit);
                }
                assert.deepEqual(result.newBranch, c.expectedNewBranch);
                assert.equal(result.switchBranch, c.expectedSwitchBranch);
            }));
        });
    });
    describe("executeCheckout", function () {
        const cases = {
            "noop": {
                input: "x=S",
                committish: null,
                newBranch: null,
                switchBranch: null,
            },
            "just a commit": {
                input: "x=S:C2-1;Bfoo=2",
                committish: "foo",
                newBranch: null,
                switchBranch: null,
                expected: "x=E:H=2",
            },
            "just a branch": {
                input: "x=S",
                committish: null,
                newBranch: {
                    name: "foo",
                    tracking: null,
                },
                switchBranch: "foo",
                expected: "x=E:Bfoo=1;*=foo",
            },
            "commit and a branch": {
                input: "x=S:C2-1;Bfoo=2",
                committish: "foo",
                newBranch: {
                    name: "bar",
                    tracking: null,
                },
                switchBranch: "bar",
                expected: "x=E:Bbar=2;*=bar",
            },
            "branch with local tracking": {
                input: "x=S",
                committish: null,
                newBranch: {
                    name: "bar",
                    tracking: {
                        remoteName: null,
                        branchName: "master",
                    },
                },
                switchBranch: "bar",
                expected: "x=E:Bbar=1 master;*=bar",
            },
            "branch with remote tracking": {
                input: "a=B|x=Ca",
                committish: null,
                newBranch: {
                    name: "bar",
                    tracking: {
                        remoteName: "origin",
                        branchName: "master",
                    },
                },
                switchBranch: "bar",
                expected: "x=E:Bbar=1 origin/master;*=bar",
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const manipulator = co.wrap(function *(repos) {
                    const repo = repos.x;
                    let commit = null;
                    if (null !== c.committish) {
                        const annotated = yield GitUtil.resolveCommitish(
                                                                 repo,
                                                                 c.committish);
                        assert.isNotNull(annotated);
                        commit = yield repo.getCommit(annotated.id());
                    }
                    const force = c.force || false;
                    yield Checkout.executeCheckout(repo,
                                                   commit,
                                                   c.newBranch,
                                                   c.switchBranch,
                                                   force);
                });
                yield RepoASTTestUtil.testMultiRepoManipulator(c.input,
                                                               c.expected,
                                                               manipulator,
                                                               c.fails);
            }));
        });
    });
});
