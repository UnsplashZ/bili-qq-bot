import { useRef, useState } from 'react'
import api from '../../../utils/auth'

export default function useMcpActions({
    show,
    mcpConfig,
    setMcpConfig,
    mcpVersion,
    setMcpVersion,
    refreshMcpConfig
}) {
    const [savingMcp, setSavingMcp] = useState(false)
    const mcpInFlightRef = useRef(false)

    const [mcpToRemove, setMcpToRemove] = useState(null)
    const [isAddMcpModalOpen, setIsAddMcpModalOpen] = useState(false)
    const [newMcp, setNewMcp] = useState({
        name: '',
        type: 'stdio',
        url: '',
        command: '',
        args: '',
        env: '{}'
    })

    const [editingMcpIndex, setEditingMcpIndex] = useState(null)
    const [isEditMcpModalOpen, setIsEditMcpModalOpen] = useState(false)
    const [editMcp, setEditMcp] = useState({
        name: '',
        type: 'stdio',
        url: '',
        command: '',
        args: '',
        env: '{}'
    })

    const handleAddMcp = async () => {
        if (mcpInFlightRef.current) return
        mcpInFlightRef.current = true
        setSavingMcp(true)
        const unlockTimeout = setTimeout(() => {
            mcpInFlightRef.current = false
            setSavingMcp(false)
        }, 20000)

        try {
            const selectedType = newMcp.type || 'stdio'
            if (selectedType !== 'stdio' && !newMcp.url.trim()) {
                show('URL 不能为空', 'error')
                return
            }

            let env = {}
            if (selectedType === 'stdio') {
                try {
                    env = JSON.parse(newMcp.env)
                } catch {
                    show('环境变量 JSON 格式无效', 'error')
                    return
                }
            }

            const args = selectedType === 'stdio'
                ? newMcp.args.split(',').map(s => s.trim()).filter(Boolean)
                : []

            const newServer = {
                name: newMcp.name,
                type: selectedType,
                url: selectedType === 'stdio' ? '' : newMcp.url.trim(),
                command: selectedType === 'stdio' ? newMcp.command : '',
                args,
                env: selectedType === 'stdio' ? env : {},
                enabled: true
            }

            const updatedServers = [...mcpConfig.mcpServers, newServer]

            setMcpConfig({ mcpServers: updatedServers })
            setIsAddMcpModalOpen(false)
            setNewMcp({ name: '', type: 'stdio', url: '', command: '', args: '', env: '{}' })

            const response = await api.post('/api/mcp', { mcpServers: updatedServers, version: mcpVersion })

            if (!response.data.reloadSuccess) {
                show(response.data.warning || '配置已保存但服务可能未更新', 'warning')
            } else {
                show('MCP 服务器已添加并生效', 'success')
            }

            if (response.data.version !== undefined) {
                setMcpVersion(response.data.version)
            }
        } catch (error) {
            if (error.response?.status === 409) {
                show('配置已被其他用户修改，请刷新后重试', 'error')
                try {
                    await refreshMcpConfig()
                } catch (fetchError) {
                    console.error('Failed to refresh MCP config:', fetchError)
                }
                return
            }
            console.error('Failed to add MCP server:', error)
            show('添加 MCP 服务器失败', 'error')
        } finally {
            clearTimeout(unlockTimeout)
            mcpInFlightRef.current = false
            setSavingMcp(false)
        }
    }

    const removeMcpServer = (index) => {
        setMcpToRemove(index)
    }

    const confirmRemoveMcp = async () => {
        if (mcpToRemove === null) return
        if (mcpInFlightRef.current) return
        mcpInFlightRef.current = true
        setSavingMcp(true)
        const unlockTimeout = setTimeout(() => {
            mcpInFlightRef.current = false
            setSavingMcp(false)
        }, 20000)

        const index = mcpToRemove
        const updatedServers = mcpConfig.mcpServers.filter((_, i) => i !== index)
        setMcpConfig({ mcpServers: updatedServers })
        setMcpToRemove(null)

        try {
            const response = await api.post('/api/mcp', { mcpServers: updatedServers, version: mcpVersion })

            if (!response.data.reloadSuccess) {
                show(response.data.warning || '配置已保存但服务可能未更新', 'warning')
            } else {
                show('MCP 服务器已移除', 'success')
            }

            if (response.data.version !== undefined) {
                setMcpVersion(response.data.version)
            }
        } catch (error) {
            if (error.response?.status === 409) {
                show('配置已被其他用户修改，请刷新后重试', 'error')
                try {
                    await refreshMcpConfig()
                } catch (fetchError) {
                    console.error('Failed to refresh MCP config:', fetchError)
                }
                return
            }
            console.error('Failed to remove MCP server:', error)
            show('保存更改失败', 'error')
        } finally {
            clearTimeout(unlockTimeout)
            mcpInFlightRef.current = false
            setSavingMcp(false)
        }
    }

    const toggleMcpServer = async (index) => {
        if (mcpInFlightRef.current) return
        mcpInFlightRef.current = true
        setSavingMcp(true)
        const unlockTimeout = setTimeout(() => {
            mcpInFlightRef.current = false
            setSavingMcp(false)
        }, 20000)

        const updatedServers = [...mcpConfig.mcpServers]
        const previousEnabled = updatedServers[index].enabled
        updatedServers[index].enabled = !previousEnabled
        setMcpConfig({ mcpServers: updatedServers })

        try {
            const response = await api.post('/api/mcp', { mcpServers: updatedServers, version: mcpVersion })

            if (!response.data.reloadSuccess) {
                show(response.data.warning || '配置已保存但服务可能未更新', 'warning')
            } else {
                show(updatedServers[index].enabled ? '已启用 MCP 服务器' : '已禁用 MCP 服务器', 'success')
            }

            if (response.data.version !== undefined) {
                setMcpVersion(response.data.version)
            }
        } catch (error) {
            if (error.response?.status === 409) {
                show('配置已被其他用户修改，请刷新后重试', 'error')
                try {
                    await refreshMcpConfig()
                } catch (fetchError) {
                    console.error('Failed to refresh MCP config:', fetchError)
                }
                return
            }
            console.error('Failed to toggle MCP server:', error)
            const revertedServers = [...updatedServers]
            revertedServers[index].enabled = previousEnabled
            setMcpConfig({ mcpServers: revertedServers })
            show('切换 MCP 服务器失败', 'error')
        } finally {
            clearTimeout(unlockTimeout)
            mcpInFlightRef.current = false
            setSavingMcp(false)
        }
    }

    const openEditMcpModal = (index) => {
        const server = mcpConfig.mcpServers[index]
        setEditingMcpIndex(index)
        setEditMcp({
            name: server.name,
            type: server.type || 'stdio',
            url: server.url || '',
            command: server.command,
            args: server.args?.join(', ') || '',
            env: JSON.stringify(server.env || {}, null, 2)
        })
        setIsEditMcpModalOpen(true)
    }

    const handleEditMcp = async () => {
        if (mcpInFlightRef.current) return
        mcpInFlightRef.current = true
        setSavingMcp(true)
        const unlockTimeout = setTimeout(() => {
            mcpInFlightRef.current = false
            setSavingMcp(false)
        }, 20000)

        try {
            const oldName = mcpConfig.mcpServers[editingMcpIndex].name
            const newName = editMcp.name.trim()
            const selectedType = editMcp.type || 'stdio'

            if (selectedType !== 'stdio' && !editMcp.url.trim()) {
                show('URL 不能为空', 'error')
                return
            }

            if (!newName) {
                show('服务器名称不能为空', 'error')
                return
            }

            if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
                show('服务器名称只能包含字母、数字、下划线和短横线', 'error')
                return
            }

            let env = {}
            if (selectedType === 'stdio') {
                try {
                    env = JSON.parse(editMcp.env)
                } catch {
                    show('环境变量 JSON 格式无效', 'error')
                    return
                }
            }

            const args = selectedType === 'stdio'
                ? editMcp.args.split(',').map(s => s.trim()).filter(Boolean)
                : []

            const updatedServers = [...mcpConfig.mcpServers]
            updatedServers[editingMcpIndex] = {
                ...updatedServers[editingMcpIndex],
                name: newName,
                type: selectedType,
                url: selectedType === 'stdio' ? '' : editMcp.url.trim(),
                command: selectedType === 'stdio' ? editMcp.command : '',
                args: selectedType === 'stdio' ? args : [],
                env: selectedType === 'stdio' ? env : {},
                enabled: updatedServers[editingMcpIndex].enabled
            }

            const isRename = oldName !== newName

            setMcpConfig({ mcpServers: updatedServers })
            setIsEditMcpModalOpen(false)
            setEditMcp({ name: '', type: 'stdio', url: '', command: '', args: '', env: '{}' })
            setEditingMcpIndex(null)

            const response = await api.post('/api/mcp', {
                mcpServers: updatedServers,
                version: mcpVersion,
                renameOperation: isRename ? { from: oldName, to: newName } : undefined
            })

            if (!response.data.reloadSuccess) {
                show(response.data.warning || '配置已保存但服务可能未更新', 'warning')
            } else {
                show('MCP 服务器已更新并生效', 'success')
            }

            if (response.data.version !== undefined) {
                setMcpVersion(response.data.version)
            }
        } catch (error) {
            if (error.response?.status === 409) {
                show('配置已被其他用户修改，请刷新后重试', 'error')
                try {
                    await refreshMcpConfig()
                } catch (fetchError) {
                    console.error('Failed to refresh MCP config:', fetchError)
                }
                return
            }
            if (error.response?.status === 400) {
                const errorMsg = error.response.data?.error || '更新失败'
                if (error.response.data.details && Array.isArray(error.response.data.details)) {
                    show(`${errorMsg}: ${error.response.data.details[0]}`, 'error')
                } else {
                    show(errorMsg, 'error')
                }
                return
            }
            console.error('Failed to update MCP server:', error)
            show('更新 MCP 服务器失败', 'error')
        } finally {
            clearTimeout(unlockTimeout)
            mcpInFlightRef.current = false
            setSavingMcp(false)
        }
    }

    return {
        savingMcp,
        mcpToRemove,
        setMcpToRemove,
        isAddMcpModalOpen,
        setIsAddMcpModalOpen,
        newMcp,
        setNewMcp,
        isEditMcpModalOpen,
        setIsEditMcpModalOpen,
        editMcp,
        setEditMcp,
        handleAddMcp,
        removeMcpServer,
        confirmRemoveMcp,
        toggleMcpServer,
        openEditMcpModal,
        handleEditMcp
    }
}
