## 0.0.1 (2026-02-26)

### Bug Fixes

- preserve SecretRef instances in PathTree deep clone ([d9584c9](https://github.com/pantoninho/keyshelf/commit/d9584c9f9528f2d047e0cba921051a51b63158ff))
- resolve TypeScript strict mode error in yaml.ts represent callback ([f337b23](https://github.com/pantoninho/keyshelf/commit/f337b23023d217fd22812c40f08e7aaeec2fc34e))

### Features

- add createProvider factory and refactor commands ([44c86d2](https://github.com/pantoninho/keyshelf/commit/44c86d22a0e89ed68394a9e61ee97ac961c126fb))
- add ref() to SecretProvider and refactor env:print for IaC integration ([6974fae](https://github.com/pantoninho/keyshelf/commit/6974faeb053c166ac5bb9e2f0276844af18da2f5))
- define SecretProvider interface ([9c254df](https://github.com/pantoninho/keyshelf/commit/9c254df31a49cfd04411851a1cd610f38f5d5c3d))
- implement config:add and config:get commands ([34d2796](https://github.com/pantoninho/keyshelf/commit/34d27964b15e514a002e6a7c873a75a1263a79d5))
- implement config:rm and config:list commands ([629ccc2](https://github.com/pantoninho/keyshelf/commit/629ccc26ace8e85837ad5f2cbc0f596ecfc06b03))
- implement env:create command ([9f6b7ea](https://github.com/pantoninho/keyshelf/commit/9f6b7ea0bb6842dcf7295772c9aceb64851d53ff))
- implement env:load command ([7d7c284](https://github.com/pantoninho/keyshelf/commit/7d7c284b3b542bbce5b64b4afeeba21760ab4a32))
- implement env:print command ([dc4f372](https://github.com/pantoninho/keyshelf/commit/dc4f372e480f37d5a3ab3ebeb8c54434d29e2005))
- implement environment definition loading and saving ([49c040d](https://github.com/pantoninho/keyshelf/commit/49c040dabb0ea2b97dab6eeae3ea3b9f22db24a2))
- implement environment resolver with import merging ([6ddded8](https://github.com/pantoninho/keyshelf/commit/6ddded85fc94248c654a5d700d3992dd6287ad72))
- implement GCP Secret Manager adapter ([977a8fb](https://github.com/pantoninho/keyshelf/commit/977a8fbb7819bad787ff4901e4b0fb63f6aaee64))
- implement init command ([560a005](https://github.com/pantoninho/keyshelf/commit/560a005e9ffa8cd6a90d11c7aa2eaf4e27abcca0))
- implement local filesystem secret provider ([0bc66f8](https://github.com/pantoninho/keyshelf/commit/0bc66f8a77d6c2cf2da1b4713d7a6f15bad377fb))
- implement PathTree with get, set, delete, list, merge ([73fb079](https://github.com/pantoninho/keyshelf/commit/73fb079a90ecf9b26b38a44079af4ba845d9c503))
- implement secret:add and secret:get commands ([46ffaf0](https://github.com/pantoninho/keyshelf/commit/46ffaf078860d7f21960a4034b7977242fc7adf0))
- implement secret:rm and secret:list commands ([c9b88d6](https://github.com/pantoninho/keyshelf/commit/c9b88d669a0d20f5ab2c951c57378a514607c3eb))
- implement YAML parser with !secret custom tag ([c43d705](https://github.com/pantoninho/keyshelf/commit/c43d705a60a9d77f6dd299e20acba54622c54170))
- improve error messages and help text ([df86b55](https://github.com/pantoninho/keyshelf/commit/df86b55d4a568a5f53835646e7f0e23d09db24f3))
- update init command to support adapter selection ([261b94e](https://github.com/pantoninho/keyshelf/commit/261b94ede5481bd11844f3236e65fa5dedb051b0))
- validate keyshelf.yml on load ([c4ea4f5](https://github.com/pantoninho/keyshelf/commit/c4ea4f521df6df6e637bf9d48a5d82c0e0da9cd1))
- widen provider config type for adapter-specific fields ([e7e018e](https://github.com/pantoninho/keyshelf/commit/e7e018e399c27f81eebf8ef7ec0cc1d2b36115ff))
