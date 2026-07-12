'use strict'

const path = require('path')
const { installWriteBarrier } = require('./runtime-data-safety')

const projectRoot = path.resolve(__dirname, '../..')
installWriteBarrier({
    protectedRoots: [path.join(projectRoot, 'config'), path.join(projectRoot, 'data')]
})
