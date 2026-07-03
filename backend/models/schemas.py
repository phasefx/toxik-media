from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict, Union
from datetime import datetime

class TagItem(BaseModel):
    id: int
    full_tag: str
    depth: int
    parent_tag: Optional[str] = None
    count: Optional[int] = 0

class TagCreate(BaseModel):
    full_tag: str

class TagRename(BaseModel):
    new_full_tag: str

class MediaItem(BaseModel):
    id: str
    filename: str
    filepath: str
    file_hash: Optional[str] = None
    media_type: str
    mime_type: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration_ms: Optional[int] = None
    file_size: Optional[int] = None
    thumb_url: Optional[str] = None
    created_at: Optional[str] = None
    modified_at: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    tags: List[str] = []

class MediaImportRequest(BaseModel):
    paths: List[str]
    tags: List[str] = []

class BatchTagRequest(BaseModel):
    media_ids: List[str]
    add_tags: List[str] = []
    remove_tags: List[str] = []
    replace_tags: Optional[Dict[str, str]] = None
    clear_all: bool = False

class RepresentativeThumb(BaseModel):
    id: str
    thumb_url: str
    media_type: str

class AggregateResult(BaseModel):
    type: str = "aggregate"
    label: str
    full_filter: str
    count: int
    representative: Optional[RepresentativeThumb] = None
    item_ids: List[str] = []

class ItemResult(BaseModel):
    type: str = "item"
    media: MediaItem

class BrowseResponse(BaseModel):
    filter: Optional[str] = None
    total_items: int
    page: int
    limit: int
    results: List[Union[AggregateResult, ItemResult]]

class WorkflowInput(BaseModel):
    name: str
    type: str
    required: bool = False
    default: Optional[Any] = None

class FormFieldItem(BaseModel):
    label: str
    node_id: str
    field_name: str
    type: str  # "textarea"|"string"|"number"|"combo"|"combo_number"|"checkbox"
    default: Any = ""
    options: List[str] = []

class WorkflowItem(BaseModel):
    id: str
    name: str
    type: str
    file: str
    expects: str = "none"  # "image", "video", "audio", "video,audio", "none"
    outputs: str = "none"  # "image", "video", "audio", "none"
    form_fields: List[FormFieldItem] = []
    tags_auto: List[str] = []
    is_utility: bool = False
    inputs: Optional[List[WorkflowInput]] = None  # backward compat

class GenerateRequest(BaseModel):
    workflow_id: str
    inputs: Dict[str, Any]
    tags: List[str] = []

class JobItem(BaseModel):
    id: str
    workflow_id: str
    status: str
    inputs: Dict[str, Any]
    progress: float = 0.0
    output_ids: Optional[List[str]] = None
    error: Optional[str] = None
    created_at: Optional[str] = None
    completed_at: Optional[str] = None
