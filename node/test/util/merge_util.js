/*
 * Copyright (c) 2017, Two Sigma Open Source
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

const assert       = require("chai").assert;
const co           = require("co");

const MergeUtil       = require("../../lib//util/merge_util");
const RepoASTTestUtil = require("../../lib/util/repo_ast_test_util");

/**
 * Return the commit map required by 'RepoASTTestUtil.testMultiRepoManipulator'
 * from the specified 'result' returned by the 'merge' and 'continue' function,
 * using the specified 'maps' provided to the manipulators.
 */
function mapReturnedCommits(result, maps) {
    assert.isObject(result);
    let newCommitMap = {};

    // If a new commit was generated -- it wasn't a fast-forward commit --
    // record a mapping from the new commit to it's logical name: "x".

    const commitMap = maps.commitMap;
    if (!(result.metaCommit in commitMap)) {
        newCommitMap[result.metaCommit] = "x";
    }

    // Map the new commits in submodules to the names of the submodules where
    // they were made.

    Object.keys(result.submoduleCommits).forEach(name => {
        commitMap[result.submoduleCommits[name]] = name;
    });
    return {
        commitMap: newCommitMap,
    };
}

describe("MergeUtil", function () {
    describe("fastForwardMerge", function () {
        const MODE = MergeUtil.MODE;
        const cases = {
            "simple": {
                initial: "x=S:C2-1;Bfoo=2",
                commit: "2",
                mode: MODE.NORMAL,
                expected: "x=E:Bmaster=2",
            },
            "simple, FF_ONLY": {
                initial: "x=S:C2-1;Bfoo=2",
                commit: "2",
                mode: MODE.FF_ONLY,
                expected: "x=E:Bmaster=2",
            },
            "simple detached": {
                initial: "x=S:C2-1;Bfoo=2;*=",
                commit: "2",
                mode: MODE.NORMAL,
                expected: "x=E:H=2",
            },
            "with submodule": {
                initial: "a=B:Ca-1;Ba=a|x=U:C3-2 s=Sa:a;Bfoo=3",
                commit: "3",
                mode: MODE.NORMAL,
                expected: "x=E:Bmaster=3",
            },
            "with open submodule": {
                initial: "a=B:Ca-1;Ba=a|x=U:C3-2 s=Sa:a;Bfoo=3;Os",
                commit: "3",
                mode: MODE.NORMAL,
                expected: "x=E:Bmaster=3;Os H=a",
            },
            "with open submodule and change": {
                initial: `
a=B:Ca-1;Ba=a|
x=U:C3-2 s=Sa:a;Bfoo=3;Os W README.md=3`,
                commit: "3",
                mode: MODE.NORMAL,
                expected: "x=E:Bmaster=3;Os H=a!W README.md=3",
            },
            "with open submodule and conflict": {
                initial: `
a=B:Ca-1;Ba=a|
x=U:C3-2 s=Sa:a;Bfoo=3;Os W a=b`,
                commit: "3",
                mode: MODE.NORMAL,
                fails: true,
            },
            "force commit": {
                initial: "x=S:C2-1;Bfoo=2",
                commit: "2",
                mode: MODE.FORCE_COMMIT,
                expected: "x=E:Chahaha\n#x-1,2 2=2;Bmaster=x",
                message: "hahaha",
            },
            "force commit, detached": {
                initial: "x=S:C2-1;Bfoo=2;*=",
                commit: "2",
                mode: MODE.FORCE_COMMIT,
                expected: "x=E:Chahaha\n#x-1,2 2=2;H=x",
                message: "hahaha",
            },
            "ff merge adding submodule": {
                initial: "a=S|x=U:Bfoo=1;*=foo",
                commit: "2",
                expected: "x=E:Bfoo=2",
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            const ffwd = co.wrap(function *(repos, maps) {
                const x = repos.x;
                const reverseCommitMap = maps.reverseCommitMap;
                assert.property(reverseCommitMap, c.commit);
                const physicalCommit = reverseCommitMap[c.commit];
                const commit = yield x.getCommit(physicalCommit);
                const message = c.message || "message\n";
                const mode = c.mode || MODE.NORMAL;
                const result = yield MergeUtil.fastForwardMerge(x,
                                                                mode,
                                                                commit,
                                                                message);
                let newCommitMap = {};
                if (null !== result) {
                    assert.isString(result);
                    // If a new commit was generated, map it to "x".

                    newCommitMap[result] = "x";
                }
                return {
                    commitMap: newCommitMap,
                };
            });
            it(caseName, co.wrap(function *() {
                yield RepoASTTestUtil.testMultiRepoManipulator(c.initial,
                                                               c.expected,
                                                               ffwd,
                                                               c.fails);
            }));
        });
    });

    describe("merge", function () {
        // Will do merge from repo `x`.  A merge commit in the meta-repo will
        // be named `x`; any merge commits in the sub-repos will be given the
        // name of the sub-repo in which they are made.  TODO: test for changes
        // to submodule shas, and submodule deletions

        // Test plan:
        // - basic merging with meta-repo: normal/ffw/force commit; note that
        //   fast-forward merges are tested in the driver for
        //   'fastForwardMerge', so we just need to validate that it works once
        //   here
        // - many scenarios with submodules
        //   - merges with open/closed unaffected submodules
        //   - where submodules are opened and closed
        //   - where they can and can't be fast-forwarded

        const MODE = MergeUtil.MODE;
        const cases = {
            "trivial -- nothing to do": {
                initial: "x=S",
                fromCommit: "1",
                expected: null,
            },
            "staged change": {
                initial: "x=S:I foo=bar",
                fromCommit: "1",
                fails: true,
            },
            "submodule commit": {
                initial: "a=B|x=U:Os Cs-1!H=s",
                fromCommit: "1",
                fails: true,
            },
            "already a merge in progress": {
                initial: "x=S:Mhia,1,1",
                fromCommit: "1",
                fails: true,
            },
            "one merge": {
                initial: "x=S:C2-1;C3-1;Bmaster=2;Bfoo=3",
                fromCommit: "3",
                expected: "x=E:Cx-2,3 3=3;Bmaster=x",
            },
            "one merge with editor": {
                initial: "x=S:C2-1;C3-1;Bmaster=2;Bfoo=3",
                fromCommit: "3",
                editMessage: () => Promise.resolve("foo\nbar\n# baz\n"),
                expected: "x=E:Cfoo\nbar\n#x-2,3 3=3;Bmaster=x",
                message: null,
            },
            "one merge with empty message": {
                initial: "x=S:C2-1;C3-1;Bmaster=2;Bfoo=3",
                fromCommit: "3",
                editMessage: () => Promise.resolve(""),
                message: null,
            },
            "non-ffmerge with ffwd submodule change": {
                initial: `
a=Aa:Cb-a;Bb=b;Cc-b;Bc=c|
x=U:C3-2 s=Sa:b;C4-2 s=Sa:c;Bmaster=3;Bfoo=4;Os`,
                fromCommit: "4",
                expected: "x=E:Cx-3,4 s=Sa:c;Os H=c;Bmaster=x",
            },
            "non-ffmerge with ffwd submodule change on lhs": {
                initial: `
a=Aa:Cb-a;Bb=b;Cc-b;Bc=c|
x=U:C3-2 s=Sa:b;C4-2;Bmaster=3;Bfoo=4`,
                fromCommit: "4",
                expected: "x=E:Cx-3,4 4=4;Bmaster=x",
            },
            "non-ffmerge with ffwd submodule change, auto-close": {
                initial: `
a=Aa:Cb-a;Bb=b;Cc-b;Bc=c|
x=U:C3-2 s=Sa:b;C4-2 s=Sa:c;Bmaster=3;Bfoo=4`,
                fromCommit: "4",
                expected: "x=E:Cx-3,4 s=Sa:c;Bmaster=x",
            },
            "non-ffmerge with ffwd submodule change, doesn't auto-close": {
                initial: `
a=Aa:Cb-a;Bb=b;Cc-b;Bc=c|
x=U:C3-2 s=Sa:b;C4-2 s=Sa:c;Bmaster=3;Bfoo=4;Os`,
                fromCommit: "4",
                expected: "x=E:Cx-3,4 s=Sa:c;Bmaster=x;Os",
            },
            "non-ffmerge with non-ffwd submodule change": {
                initial: `
a=Aa:Cb-a;Cc-a;Bfoo=b;Bbar=c|
x=U:C3-2 s=Sa:b;C4-2 s=Sa:c;Bmaster=3;Bfoo=4`,
                fromCommit: "4",
                expected: "x=E:Cx-3,4 s=Sa:s;Os Cs-b,c c=c!H=s;Bmaster=x",
            },
            "non-ffmerge with non-ffwd submodule change, sub already open": {
                initial: `
a=Aa:Cb-a;Cc-a;Bfoo=b;Bbar=c|
x=U:C3-2 s=Sa:b;C4-2 s=Sa:c;Bmaster=3;Bfoo=4;Os`,
                fromCommit: "4",
                expected: "x=E:Cx-3,4 s=Sa:s;Os Cs-b,c c=c!H=s;Bmaster=x",
            },
            "submodule commit is up-to-date": {
                initial:`
a=Aa:Cb-a;Cc-b;Bfoo=b;Bbar=c|
x=U:C3-2 s=Sa:c;C4-2 s=Sa:b,x=y;Bmaster=3;Bfoo=4;Os`,
                fromCommit: "4",
                expected: "x=E:Cx-3,4 x=y;Os H=c;Bmaster=x",
            },
            "submodule commit is up-to-date, was not open": {
                initial:`
a=Aa:Cb-a;Cc-b;Bfoo=b;Bbar=c|
x=U:C3-2 s=Sa:c;C4-2 s=Sa:b,x=y;Bmaster=3;Bfoo=4`,
                fromCommit: "4",
                expected: "x=E:Cx-3,4 x=y;Bmaster=x",
            },
            "submodule commit is same": {
                initial: `
a=Aa:Cb-a;Cc-b;Bfoo=b;Bbar=c|
x=U:C3-2 s=Sa:c;C4-2 s=Sa:c,x=y;Bmaster=3;Bfoo=4`,
                fromCommit: "4",
                expected: "x=E:Cx-3,4 x=y;Bmaster=x",
            },
            "added in merge": {
                initial: `
a=B|
x=S:C2-1;C3-1 t=Sa:1;Bmaster=2;Bfoo=3`,
                fromCommit: "3",
                expected: "x=E:Cx-2,3 t=Sa:1;Bmaster=x",
            },
            "added on both sides": {
                initial: `
a=B|
x=S:C2-1 s=Sa:1;C3-1 t=Sa:1;Bmaster=2;Bfoo=3`,
                fromCommit: "3",
                expected: "x=E:Cx-2,3 t=Sa:1;Bmaster=x",
            },
            "conflicted add": {
                initial: `
a=B|b=B|
x=S:C2-1 s=Sa:1;C3-1 s=Sb:1;Bmaster=2;Bfoo=3`,
                fromCommit: "3",
                expected: "x=E:Mmessage\n,2,3",
                fails: true,
            },
            "conflict in meta": {
                initial: "x=S:C2-1 foo=bar;C3-1 foo=baz;Bmaster=2;Bfoo=3",
                fromCommit: "3",
                expected: "x=E:Mmessage\n,2,3",
                fails: true,
            },
            "conflict in submodule": {
                initial: `
a=B:Ca-1 README.md=8;Cb-1 README.md=9;Ba=a;Bb=b|
x=U:C3-2 s=Sa:a;C4-2 s=Sa:b;Bmaster=3;Bfoo=4`,
                fromCommit: "4",
                expected: "x=E:Mmessage\n,3,4;Os Mmessage\n,a,b",
                fails: true,
            },
            "new commit in sub in target branch but not in HEAD branch": {
                initial: `
a=B:Ca-1;Cb-1;Ba=a;Bb=b|
x=U:C3-2 t=Sa:1;C4-3 s=Sa:a;C5-3 t=Sa:b;Bmaster=4;Bfoo=5;Os;Ot`,
                fromCommit: "5",
                expected: `
x=E:Cx-4,5 t=Sa:b;Bmaster=x;Ot H=b;Os`
            },
            "new commit in sub in target branch but not in HEAD branch, closed"
            : {
                initial: `
a=B:Ca-1;Cb-1;Ba=a;Bb=b|
x=U:C3-2 t=Sa:1;C4-3 s=Sa:a;C5-3 t=Sa:b;Bmaster=4;Bfoo=5`,
                fromCommit: "5",
                expected: `
x=E:Cx-4,5 t=Sa:b;Bmaster=x`
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            it(caseName, co.wrap(function *() {
                const expected = c.expected;

                const doMerge = co.wrap(function *(repos, maps) {
                    const upToDate = null === expected;
                    const mode = !("mode" in c) ? MODE.NORMAL : c.mode;
                    const x = repos.x;
                    const reverseCommitMap = maps.reverseCommitMap;
                    assert.property(reverseCommitMap, c.fromCommit);
                    const physicalCommit = reverseCommitMap[c.fromCommit];
                    const commit = yield x.getCommit(physicalCommit);
                    let message = c.message;
                    if (undefined === message) {
                        message = "message\n";
                    }
                    const defaultEditor = function () {};
                    const editMessage = c.editMessage || defaultEditor;
                    const result = yield MergeUtil.merge(x,
                                                         commit,
                                                         mode,
                                                         message,
                                                         editMessage);
                    if (upToDate) {
                        assert.isNull(result);
                        return;                                       // RETURN
                    }
                    return mapReturnedCommits(result, maps);
                });
                yield RepoASTTestUtil.testMultiRepoManipulator(c.initial,
                                                               expected || {},
                                                               doMerge,
                                                               c.fails);
            }));
        });
    });
    describe("continue", function () {
        // TODO: test abort from conflicts.  Need conflict support to make this
        // work.

        const cases = {
            "no merge": {
                initial: "x=S",
                fails: true,
            },
            "continue in meta": {
                initial: "x=S:C2-1;C3-1;Bmaster=2;I baz=bam;Mhi\n,2,3;Bfoo=3",
                expected: "x=E:Chi\n#x-2,3 baz=bam;Bmaster=x;M;I baz=~",
            },
            "cheap continue in meta": {
                initial: "x=S:C2;Mhi\n,1,2;B2=2",
                expected: "x=E:Chi\n#x-1,2 ;Bmaster=x;M",
            },
            "continue with extra in non-continue sub": {
                initial: `
a=B|
x=U:C3-1;Mhi\n,2,3;B3=3;Os I README.md=8`,
                expected: `
x=E:Chi\n#x-2,3 s=Sa:s;Bmaster=x;M;Os Chi\n#s-1 README.md=8!H=s`,
            },
            "continue in a sub": {
                initial: `
a=B:Ca;Ba=a|
x=U:C3-1;Mhi\n,2,3;B3=3;Os I README.md=8!Myo\n,1,a!Ba=a`,
                expected: `
x=E:Chi\n#x-2,3 s=Sa:s;Bmaster=x;M;Os Cyo\n#s-1,a README.md=8!H=s!Ba=a`,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            const doContinue = co.wrap(function *(repos, maps) {
                const repo = repos.x;
                const result = yield MergeUtil.continue(repo);
                return mapReturnedCommits(result, maps);
            });
            it(caseName, co.wrap(function *() {
                yield RepoASTTestUtil.testMultiRepoManipulator(c.initial,
                                                               c.expected,
                                                               doContinue,
                                                               c.fails);
            }));
        });
    });
    describe("abort", function() {
        const cases = {
            "no merge": {
                initial: "x=S",
                fails: true,
            },
            "noop": {
                initial: "x=S:Mfoo,1,1",
                expected: "x=E:M",
            },
            "noop with sub": {
                initial: "a=B|x=U:Mfoo,1,1;Os Mfoo,1,1",
                expected: "x=E:M;Os M",
            },
            "moved back a sub": {
                initial: `
a=B|
x=U:Mx,1,1;Os Cs-1!H=s!Bs=s`,
                expected: `x=E:M;Os H=1!Cs-1!Bs=s`,
            },
        };
        Object.keys(cases).forEach(caseName => {
            const c = cases[caseName];
            const doAbort = co.wrap(function *(repos) {
                const repo = repos.x;
                yield MergeUtil.abort(repo);
            });
            it(caseName, co.wrap(function *() {
                yield RepoASTTestUtil.testMultiRepoManipulator(c.initial,
                                                               c.expected,
                                                               doAbort,
                                                               c.fails);
            }));
        });
    });
});
