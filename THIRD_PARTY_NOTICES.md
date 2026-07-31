# 第三方软件与素材声明

快捷宠包含或依赖以下第三方软件与素材。各项目仍归其各自权利人所有，并适用各自许可证。本文不是对许可证原文的替代。

## 运行时依赖

| 组件 | 当前使用版本 | 许可证 | 项目地址 |
| --- | --- | --- | --- |
| OpenCV.js (`@techstark/opencv-js`) | `5.0.0-release.1` | Apache License 2.0 | <https://github.com/TechStark/opencv-js> |
| extract-zip | `2.0.1` | BSD 2-Clause | <https://github.com/maxogden/extract-zip> |
| Three.js | `0.179.1` | MIT | <https://github.com/mrdoob/three.js> |
| PixiJS | `8.13.1` | MIT | <https://github.com/pixijs/pixijs> |
| untitled-pixi-live2d-engine | `1.3.5` | MIT | <https://github.com/Untitled-Story/untitled-pixi-live2d-engine> |
| `@hazart-pkg/live2d-core` 包装包 | `1.0.1` | ISC（包装包元数据） | <https://github.com/hazart29/live2d-core-v5> |

## 构建与开发依赖

| 组件 | 当前安装版本 | 许可证 | 项目地址 |
| --- | --- | --- | --- |
| Electron | `37.10.3` | MIT | <https://github.com/electron/electron> |
| esbuild | `0.25.8` | MIT | <https://github.com/evanw/esbuild> |
| electron-builder | `26.15.3` | MIT | <https://github.com/electron-userland/electron-builder> |

依赖的完整许可证文本可在对应软件包、源代码仓库及发布包中查看。

## Live2D Cubism Core

`@hazart-pkg/live2d-core` 中的 Live2D Cubism Core 并不因包装包的 ISC 元数据而变为 ISC 软件。

Live2D Cubism Core 归 Live2D Inc. 所有，依据 Live2D Proprietary Software License Agreement 提供。其可再分发文件清单包括：

- `live2dcubismcore.d.ts`
- `live2dcubismcore.js`
- `live2dcubismcore.min.js`

许可协议：

- 英文：<https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html>
- 中文：<https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_cn.html>

用户导入的 Live2D 模型、纹理、动作和其他素材不随快捷宠取得授权。用户必须遵守模型作者及 Live2D 的相关使用条件。

## 内置狐狸 3D 模型

内置狐狸来自 KhronosGroup 的 glTF Sample Assets：

<https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox>

原项目署名如下：

- Model：PixelMannen，CC0 1.0。
- Rigging and animation：tomkranis，CC BY 4.0。
- glTF conversion：AsoboStudio、scurest，CC BY 4.0。

相关许可：

- CC0 1.0：<https://creativecommons.org/publicdomain/zero/1.0/>
- CC BY 4.0：<https://creativecommons.org/licenses/by/4.0/>

快捷宠对模型进行显示尺寸、方向和动作选择等运行时适配，不主张拥有原始狐狸模型的著作权。

## Electron 内含组件

Electron 发布文件还包含 Chromium、Node.js 及其他第三方组件。其详细许可和声明由 Electron 随发行文件提供，可在 Electron 项目的许可页面和打包后的 `LICENSES.chromium.html` 等文件中查阅。

Electron 许可信息：<https://github.com/electron/electron/blob/main/LICENSE>

## 许可证说明

MIT、ISC、BSD 2-Clause、Apache License 2.0、CC0 1.0、CC BY 4.0 和 Live2D Proprietary Software License 的权利义务各不相同。分发快捷宠或修改后的版本前，请阅读对应许可证原文，并保留所要求的版权、许可和署名信息。
