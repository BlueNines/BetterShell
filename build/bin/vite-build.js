#!/bin/bash
const { exec, cd } = require('shelljs')
const { resolve } = require('path')
const p = resolve(__dirname, '../vite')
cd(p)

// 把前端编译错误传回总构建脚本，不能继续复制旧产物。
process.exitCode = exec('npm run build').code
