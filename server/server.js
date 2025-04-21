// Rotas administrativas
app.get('/api/status', async (req, res) => {
    const status = await db.verificarStatusBanco();
    res.json(status);
});

app.get('/api/admin/simulacoes', async (req, res) => {
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = parseInt(req.query.limite) || 10;
    const filtro = req.query.filtro || '';
    
    const resultado = await db.listarSimulacoes(pagina, limite, filtro);
    
    if (resultado.success) {
        res.json(resultado);
    } else {
        res.status(500).json({ 
            success: false, 
            error: resultado.error || 'Erro ao listar simulações' 
        });
    }
});

app.delete('/api/admin/simulacoes/:id', async (req, res) => {
    const simulacaoId = req.params.id;
    
    if (!simulacaoId) {
        return res.status(400).json({ 
            success: false, 
            error: 'ID da simulação não fornecido' 
        });
    }
    
    const resultado = await db.excluirSimulacao(simulacaoId);
    
    if (resultado.success) {
        res.json(resultado);
    } else {
        const codigoStatus = resultado.error === 'Simulação não encontrada' ? 404 : 500;
        res.status(codigoStatus).json(resultado);
    }
});

app.get('/api/admin/clientes', async (req, res) => {
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = parseInt(req.query.limite) || 10;
    const filtro = req.query.filtro || '';
    
    const resultado = await db.listarClientes(pagina, limite, filtro);
    
    if (resultado.success) {
        res.json(resultado);
    } else {
        res.status(500).json({ 
            success: false, 
            error: resultado.error || 'Erro ao listar clientes' 
        });
    }
}); 