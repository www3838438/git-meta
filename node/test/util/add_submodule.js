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

const co = require("co");
const fs = require("fs-promise");

const AddSubmodule    = require("../../lib/util/add_submodule");
const RepoASTTestUtil = require("../../lib/util/repo_ast_test_util");

describe("AddSubmodule", function () {
    const cases = {
        "simple": {
            input: "a=B|x=Ca",
            name: "s",
            url: "/foo",
            expected: "x=E:I s=S/foo:;Os",
        },
        "nested": {
            input: "a=B|x=Ca",
            name: "s/t/u",
            url: "/foo/bar",
            expected: "x=E:I s/t/u=S/foo/bar:;Os/t/u",
        },
        "import": {
            input: "a=B|h=B:Cy-1;Bmaster=y|x=Ca",
            name: "s",
            url: "/foo/bar",
            import: { url: "h", branch: "master" },
            expected: "x=E:I s=S/foo/bar:;Os Rupstream=h master=y!H=y",
        },
    };
    Object.keys(cases).forEach(caseName => {
        const c = cases[caseName];
        it(caseName, co.wrap(function *() {
            const doNew = co.wrap(function *(repos) {
                let imp = c.import || null;
                if (null !== imp) {
                    const url = yield fs.realpath(repos[imp.url].path());
                    imp = { url: url, branch: imp.branch};
                }
                yield AddSubmodule.addSubmodule(repos.x, c.url, c.name, imp);
            });
            yield RepoASTTestUtil.testMultiRepoManipulator(c.input,
                                                           c.expected,
                                                           doNew,
                                                           c.fails);
        }));
    });
});
