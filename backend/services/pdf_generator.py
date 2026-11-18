import os
from xml.sax.saxutils import escape
import calendar
from datetime import datetime, date
from typing import Optional
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, white
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from sqlalchemy.orm import Session
from database import DATA_DIR
import models
from services.calculos import calcular_saldo_pessoa_mes

MESES_PT = {
    1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril",
    5: "Maio", 6: "Junho", 7: "Julho", 8: "Agosto",
    9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro"
}

def fmt_brl(val: float) -> str:
    s = f"{val:,.2f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")

def gerar_pdf_fechamento(db: Session, pessoa_id: int, mes: int, ano: int, nome_sistema: str = "Administração Financeira") -> str:
    pessoa = db.query(models.Pessoa).filter(models.Pessoa.id == pessoa_id).first()
    if not pessoa:
        raise ValueError("Pessoa não encontrada")

    saldo_info = calcular_saldo_pessoa_mes(db, pessoa_id, mes, ano)

    # Coleta os lançamentos do mês
    lancamentos_mes = []
    lancamentos_query = db.query(models.Lancamento).filter(
        models.Lancamento.pessoa_id == pessoa_id,
        models.Lancamento.cancelado == False
    ).all()

    for lanc in lancamentos_query:
        for parcela in lanc.parcelas:
            if parcela.status == "cancelado":
                continue
            if parcela.mes == mes and parcela.ano == ano:
                origem = lanc.cartao.nome if lanc.cartao else ("Conta / Dinheiro" if lanc.conta else "Outro")
                lancamentos_mes.append({
                    "descricao": lanc.descricao,
                    "parcela": f"{parcela.numero}/{lanc.total_parcelas}" if lanc.total_parcelas > 1 else "À vista",
                    "origem": origem,
                    "valor": parcela.valor,
                    "status": parcela.status,
                    "data": lanc.data_lancamento.strftime("%d/%m/%Y")
                })

    # Coleta os pagamentos do mês
    _, ultimo_dia = calendar.monthrange(ano, mes)
    pagamentos = db.query(models.PagamentoPessoa).filter(
        models.PagamentoPessoa.pessoa_id == pessoa_id,
        models.PagamentoPessoa.data >= date(ano, mes, 1),
        models.PagamentoPessoa.data <= date(ano, mes, ultimo_dia)
    ).order_by(models.PagamentoPessoa.data.asc()).all()

    # Coleta parcelas futuras a vencer nos próximos meses
    parcelas_futuras = []
    for lanc in lancamentos_query:
        for p in lanc.parcelas:
            if (p.ano > ano) or (p.ano == ano and p.mes > mes):
                if p.status not in ("pago", "cancelado"):
                    origem = lanc.cartao.nome if lanc.cartao else ("Conta / Dinheiro" if lanc.conta else "Outro")
                    parcelas_futuras.append({
                        "data_ord": (p.ano, p.mes),
                        "mes_ano": f"{MESES_PT[p.mes][:3]}/{p.ano}",
                        "descricao": lanc.descricao,
                        "parcela": f"{p.numero}/{lanc.total_parcelas}" if lanc.total_parcelas > 1 else "À vista",
                        "origem": origem,
                        "valor": p.valor
                    })
    parcelas_futuras.sort(key=lambda x: (x["data_ord"], x["descricao"]))
    total_futuro = sum(p["valor"] for p in parcelas_futuras)

    # Pasta para salvar os PDFs
    pdf_dir = os.path.join(DATA_DIR, "pdfs")
    os.makedirs(pdf_dir, exist_ok=True)

    nome_sanitizado = "".join(c for c in pessoa.nome if c.isalnum() or c in (" ", "_", "-")).rstrip().replace(" ", "_")
    filename = f"fechamento_{pessoa.id}_{nome_sanitizado}_{mes:02d}_{ano}.pdf"
    filepath = os.path.join(pdf_dir, filename)

    doc = SimpleDocTemplate(
        filepath,
        pagesize=A4,
        rightMargin=1.8*cm,
        leftMargin=1.8*cm,
        topMargin=1.8*cm,
        bottomMargin=1.8*cm
    )

    COR_PRIMARIA = HexColor("#1E3A8A")     # Azul marinho elegante
    COR_SECUNDARIA = HexColor("#EFF6FF")   # Azul clarinho
    COR_DESTAQUE = HexColor("#2563EB")     # Azul vibrante
    COR_VERMELHO = HexColor("#DC2626")     # Vermelho dívida
    COR_VERDE = HexColor("#16A34A")        # Verde pagamento/quitado
    COR_CINZA_ESCURO = HexColor("#1F2937") # Cinza texto escuro
    COR_CINZA_CLARO = HexColor("#F9FAFB")  # Fundo linhas alternadas
    COR_BORDA = HexColor("#E5E7EB")

    styles = getSampleStyleSheet()

    story = []

    nome_sistema_safe = escape(str(nome_sistema or "Administração Financeira"))

    # 1. Cabeçalho Principal
    header_content = [
        [
            Paragraph(f'<font size="18" color="white"><b>{nome_sistema_safe}</b></font><br/><font size="9" color="#93C5FD">Sistema de Gestão Financeira Pessoal</font>',
                      ParagraphStyle("HeadLeft", alignment=TA_LEFT, leading=18)),
            Paragraph(f'<font size="13" color="white"><b>EXTRATO DE FECHAMENTO</b></font><br/><font size="10" color="#DBEAFE">{MESES_PT[mes].upper()} / {ano}</font>',
                      ParagraphStyle("HeadRight", alignment=TA_RIGHT, leading=15))
        ]
    ]
    t_header = Table(header_content, colWidths=[10.5*cm, 6.9*cm])
    t_header.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), COR_PRIMARIA),
        ('PADDING', (0, 0), (-1, -1), 14),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(t_header)
    story.append(Spacer(1, 0.4*cm))

    # 2. Caixa de Identificação da Pessoa
    pessoa_content = [
        [
            Paragraph(f'<font size="10" color="#4B5563">TITULAR DO LANÇAMENTO</font><br/><font size="14" color="#111827"><b>{escape(pessoa.nome.upper())}</b></font>',
                      ParagraphStyle("PessoaNome", leading=16)),
            Paragraph(f'<font size="10" color="#4B5563">CONTATO</font><br/><font size="11" color="#111827">{escape(pessoa.telefone or "Não informado")}</font>',
                      ParagraphStyle("PessoaTel", alignment=TA_RIGHT, leading=16))
        ]
    ]
    t_pessoa = Table(pessoa_content, colWidths=[10.5*cm, 6.9*cm])
    t_pessoa.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), COR_SECUNDARIA),
        ('BOX', (0, 0), (-1, -1), 1, HexColor("#BFDBFE")),
        ('PADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(t_pessoa)
    story.append(Spacer(1, 0.4*cm))

    # 3. Alerta de Dívida Anterior (se houver)
    if saldo_info["saldo_anterior"] > 0:
        div_ant = [
            [
                Paragraph('<font size="11" color="#991B1B"><b>⚠️ SALDO PENDENTE DO MÊS ANTERIOR</b></font><br/><font size="8" color="#B91C1C">Valor que não foi quitado no período anterior e foi transferido para este fechamento.</font>',
                          ParagraphStyle("DivAntDesc", leading=12)),
                Paragraph(f'<font size="13" color="#991B1B"><b>{fmt_brl(saldo_info["saldo_anterior"])}</b></font>',
                          ParagraphStyle("DivAntVal", alignment=TA_RIGHT, leading=14))
            ]
        ]
        t_ant = Table(div_ant, colWidths=[12.4*cm, 5.0*cm])
        t_ant.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), HexColor("#FEF2F2")),
            ('BOX', (0, 0), (-1, -1), 1.5, HexColor("#FCA5A5")),
            ('PADDING', (0, 0), (-1, -1), 8),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(t_ant)
        story.append(Spacer(1, 0.4*cm))

    # 4. Tabela de Lançamentos do Mês
    story.append(Paragraph(f'<font size="11" color="{COR_CINZA_ESCURO}"><b>DETALHAMENTO DOS GASTOS DO MÊS ({len(lancamentos_mes)})</b></font>',
                           ParagraphStyle("SecTitle", spaceAfter=6)))

    if lancamentos_mes:
        t_rows = [[
            Paragraph("<b>Data</b>", ParagraphStyle("TH", fontName="Helvetica-Bold", fontSize=9, textColor=white)),
            Paragraph("<b>Descrição</b>", ParagraphStyle("TH", fontName="Helvetica-Bold", fontSize=9, textColor=white)),
            Paragraph("<b>Origem / Cartão</b>", ParagraphStyle("TH", fontName="Helvetica-Bold", fontSize=9, textColor=white)),
            Paragraph("<b>Parcela</b>", ParagraphStyle("TH", fontName="Helvetica-Bold", fontSize=9, textColor=white, alignment=TA_CENTER)),
            Paragraph("<b>Valor</b>", ParagraphStyle("TH", fontName="Helvetica-Bold", fontSize=9, textColor=white, alignment=TA_RIGHT)),
        ]]

        for item in lancamentos_mes:
            t_rows.append([
                Paragraph(escape(str(item["data"])), ParagraphStyle("TD", fontSize=8.5, textColor=COR_CINZA_ESCURO)),
                Paragraph(escape(str(item["descricao"])), ParagraphStyle("TD", fontSize=8.5, textColor=COR_CINZA_ESCURO)),
                Paragraph(escape(str(item["origem"])), ParagraphStyle("TD", fontSize=8.5, textColor=COR_CINZA_ESCURO)),
                Paragraph(escape(str(item["parcela"])), ParagraphStyle("TD", fontSize=8.5, textColor=COR_CINZA_ESCURO, alignment=TA_CENTER)),
                Paragraph(fmt_brl(item["valor"]), ParagraphStyle("TD", fontSize=8.5, textColor=COR_CINZA_ESCURO, alignment=TA_RIGHT, fontName="Helvetica-Bold")),
            ])

        t_lanc = Table(t_rows, colWidths=[2.2*cm, 6.8*cm, 4.0*cm, 2.0*cm, 2.4*cm])
        t_lanc.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COR_DESTAQUE),
            ('PADDING', (0, 0), (-1, -1), 5),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, COR_BORDA),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, COR_CINZA_CLARO]),
        ]))
        story.append(t_lanc)
    else:
        story.append(Paragraph('<i>Nenhum lançamento registrado neste mês para esta pessoa.</i>',
                               ParagraphStyle("Vazio", fontSize=9, textColor=HexColor("#6B7280"))))

    story.append(Spacer(1, 0.4*cm))

    # 5. Tabela de Pagamentos Recebidos
    if pagamentos:
        story.append(Paragraph(f'<font size="11" color="{COR_CINZA_ESCURO}"><b>PAGAMENTOS RECEBIDOS NESTE MÊS ({len(pagamentos)})</b></font>',
                               ParagraphStyle("SecTitle2", spaceAfter=6)))
        p_rows = [[
            Paragraph("<b>Data</b>", ParagraphStyle("TH2", fontName="Helvetica-Bold", fontSize=9, textColor=white)),
            Paragraph("<b>Observação / Comprovante</b>", ParagraphStyle("TH2", fontName="Helvetica-Bold", fontSize=9, textColor=white)),
            Paragraph("<b>Valor Pago</b>", ParagraphStyle("TH2", fontName="Helvetica-Bold", fontSize=9, textColor=white, alignment=TA_RIGHT)),
        ]]
        for p in pagamentos:
            p_rows.append([
                Paragraph(p.data.strftime("%d/%m/%Y"), ParagraphStyle("TD2", fontSize=8.5)),
                Paragraph(escape(" • ".join(filter(None, (p.forma_pagamento, p.observacao))) or "Pagamento registrado"), ParagraphStyle("TD2", fontSize=8.5)),
                Paragraph(fmt_brl(p.valor), ParagraphStyle("TD2", fontSize=8.5, alignment=TA_RIGHT, textColor=COR_VERDE, fontName="Helvetica-Bold")),
            ])
        t_pags = Table(p_rows, colWidths=[3.0*cm, 10.4*cm, 4.0*cm])
        t_pags.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), COR_VERDE),
            ('PADDING', (0, 0), (-1, -1), 5),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, COR_BORDA),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor("#F0FDF4")]),
        ]))
        story.append(t_pags)
        story.append(Spacer(1, 0.4*cm))

    # 6. Resumo e Saldo Final
    story.append(Paragraph(f'<font size="11" color="{COR_CINZA_ESCURO}"><b>RESUMO CONSOLIDADO DESTE FECHAMENTO</b></font>',
                           ParagraphStyle("SecTitle3", spaceAfter=6)))

    resumo_rows = [
        ["(+) Saldo acumulado do mês anterior", fmt_brl(saldo_info["saldo_anterior"])],
        ["(+) Compras e parcelas deste mês", fmt_brl(saldo_info["total_gastos_mes"])],
    ]
    if saldo_info.get("total_compras_para_mim_mes", 0) > 0:
        resumo_rows.append(["(-) Compras feitas para o titular (abatimento)", f"- {fmt_brl(saldo_info['total_compras_para_mim_mes'])}"])
    if saldo_info.get("total_reembolsos_mes", 0) > 0:
        resumo_rows.append(["(+) Reembolsos e acertos pagos a você", fmt_brl(saldo_info['total_reembolsos_mes'])])

    resumo_rows.append(["(=) Total Líquido a Pagar deste Mês", fmt_brl(saldo_info["total_a_pagar"])])
    resumo_rows.append(["(-) Pagamentos já recebidos neste mês", f"- {fmt_brl(saldo_info['total_pagamentos_mes'])}"])

    t_resumo = Table(resumo_rows, colWidths=[12.4*cm, 5.0*cm])
    t_resumo.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9.5),
        ('PADDING', (0, 0), (-1, -1), 5.5),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('GRID', (0, 0), (-1, -1), 0.5, COR_BORDA),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [white, COR_CINZA_CLARO]),
        ('FONTNAME', (0, -2), (-1, -2), 'Helvetica-Bold'),
        ('BACKGROUND', (0, -2), (-1, -2), HexColor("#DBEAFE")),
    ]))
    story.append(t_resumo)
    story.append(Spacer(1, 0.3*cm))

    # 7. Card Final em Destaque
    saldo = saldo_info["saldo_devedor"]
    credito = saldo_info["credito_a_favor"]

    if saldo > 0:
        status_label = "VALOR PENDENTE A RECEBER"
        status_val = fmt_brl(saldo)
        box_bg = HexColor("#FEF2F2")
        box_border = COR_VERMELHO
        box_text = COR_VERMELHO
    elif credito > 0:
        status_label = "CRÉDITO A FAVOR DO CLIENTE"
        status_val = fmt_brl(credito)
        box_bg = HexColor("#F0FDF4")
        box_border = COR_VERDE
        box_text = COR_VERDE
    else:
        status_label = "SITUAÇÃO DO FECHAMENTO"
        status_val = "TOTALMENTE QUITADO ✓"
        box_bg = HexColor("#F0FDF4")
        box_border = COR_VERDE
        box_text = COR_VERDE

    t_final = Table([[status_label, status_val]], colWidths=[10.4*cm, 7.0*cm])
    t_final.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), box_bg),
        ('TEXTCOLOR', (0, 0), (-1, -1), box_text),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 12),
        ('PADDING', (0, 0), (-1, -1), 10),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('BOX', (0, 0), (-1, -1), 2, box_border),
    ]))
    story.append(t_final)

    # 8. Tabela de Parcelas Futuras (se houver compras parceladas nos próximos meses)
    if parcelas_futuras:
        story.append(Spacer(1, 0.45*cm))
        story.append(Paragraph(
            f'<font size="11" color="{COR_CINZA_ESCURO}"><b>PARCELAS FUTURAS A VENCER NOS PRÓXIMOS MESES ({len(parcelas_futuras)} parcelas • Total Futuro: {fmt_brl(total_futuro)})</b></font>',
            ParagraphStyle("SecTitleFut", spaceAfter=6)
        ))
        f_rows = [[
            Paragraph("<b>Mês/Ano</b>", ParagraphStyle("THF", fontName="Helvetica-Bold", fontSize=9, textColor=white, alignment=TA_CENTER)),
            Paragraph("<b>Descrição da Compra</b>", ParagraphStyle("THF", fontName="Helvetica-Bold", fontSize=9, textColor=white)),
            Paragraph("<b>Origem / Cartão</b>", ParagraphStyle("THF", fontName="Helvetica-Bold", fontSize=9, textColor=white)),
            Paragraph("<b>Parcela</b>", ParagraphStyle("THF", fontName="Helvetica-Bold", fontSize=9, textColor=white, alignment=TA_CENTER)),
            Paragraph("<b>Valor</b>", ParagraphStyle("THF", fontName="Helvetica-Bold", fontSize=9, textColor=white, alignment=TA_RIGHT)),
        ]]
        for pf in parcelas_futuras:
            f_rows.append([
                Paragraph(escape(str(pf["mes_ano"])), ParagraphStyle("TDF", fontSize=8.5, alignment=TA_CENTER, fontName="Helvetica-Bold")),
                Paragraph(escape(str(pf["descricao"])), ParagraphStyle("TDF", fontSize=8.5)),
                Paragraph(escape(str(pf["origem"])), ParagraphStyle("TDF", fontSize=8.5)),
                Paragraph(escape(str(pf["parcela"])), ParagraphStyle("TDF", fontSize=8.5, alignment=TA_CENTER)),
                Paragraph(fmt_brl(pf["valor"]), ParagraphStyle("TDF", fontSize=8.5, alignment=TA_RIGHT, fontName="Helvetica-Bold")),
            ])
        t_fut = Table(f_rows, colWidths=[2.2*cm, 6.8*cm, 4.0*cm, 2.0*cm, 2.4*cm])
        t_fut.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor("#334155")), # Slate 700
            ('PADDING', (0, 0), (-1, -1), 4.5),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, COR_BORDA),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor("#F8FAFC")]),
        ]))
        story.append(t_fut)

    # 8. Rodapé
    story.append(Spacer(1, 0.8*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=COR_BORDA))
    story.append(Spacer(1, 0.2*cm))
    agora_str = datetime.now().strftime("%d/%m/%Y às %H:%M")
    story.append(Paragraph(
        f'<font size="8" color="#6B7280">Documento emitido em {agora_str} por {nome_sistema_safe} • Conferência para pagamento.</font>',
        ParagraphStyle("Rodape", alignment=TA_CENTER)
    ))

    doc.build(story)
    return filepath
